begin;
alter table public.messages add column revision integer not null default 1;
alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_body_check check((deleted_at is not null and body='') or (deleted_at is null and length(body) between 1 and 10000));
create function public.sync_messages(p_org uuid,p_thread uuid,p_loaded uuid[]) returns setof public.messages language plpgsql stable security definer set search_path='' as $$
begin
 if cardinality(p_loaded)>500 then raise invalid_parameter_value; end if;
 if not private.can_thread(p_thread) or not exists(select 1 from public.message_threads where id=p_thread and organization_id=p_org) then raise insufficient_privilege; end if;
 return query select m.* from public.messages m where m.thread_id=p_thread and (m.id=any(p_loaded) or m.id in(select id from public.messages where thread_id=p_thread order by created_at desc,id desc limit 50)) order by m.created_at desc,m.id desc limit 550;
end $$;
create function public.change_message(p_org uuid,p_thread uuid,p_id uuid,p_action text,p_body text,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare msg public.messages;
begin
 if not private.can_thread(p_thread) or not exists(select 1 from public.message_threads where id=p_thread and organization_id=p_org) then raise insufficient_privilege; end if;
 select * into msg from public.messages where id=p_id and thread_id=p_thread for update;
 if msg.id is null or msg.author_id<>auth.uid() then raise insufficient_privilege; end if;
 if msg.revision<>p_revision or msg.deleted_at is not null then raise exception 'Message changed; refresh before editing' using errcode='40001'; end if;
 if p_action='edit' and length(trim(p_body)) between 1 and 10000 then
  update public.messages set body=trim(p_body),updated_at=now(),revision=revision+1 where id=p_id returning * into msg;
 elsif p_action='delete' then
  update public.messages set body='',deleted_at=now(),updated_at=now(),revision=revision+1 where id=p_id returning * into msg;
 else raise invalid_parameter_value;end if;
 return to_jsonb(msg);
end $$;
revoke all on function public.sync_messages(uuid,uuid,uuid[]),public.change_message(uuid,uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.sync_messages(uuid,uuid,uuid[]),public.change_message(uuid,uuid,uuid,text,text,integer) to authenticated;
-- Postgres Changes obeys existing message SELECT RLS. No broadcast with message bodies.
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then alter publication supabase_realtime add table public.messages;end if;end $$;

create table public.scheduled_messages(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations,thread_id uuid not null references public.message_threads,author_id uuid not null references public.profiles,client_message_id uuid not null,body text not null check(length(body) between 1 and 10000),send_at timestamptz not null,status text not null default 'PENDING' check(status in ('PENDING','SENT','CANCELLED','FAILED')),created_at timestamptz not null default now(),unique(thread_id,author_id,client_message_id),foreign key(thread_id,organization_id) references public.message_threads(id,organization_id));
create index scheduled_due on public.scheduled_messages(send_at) where status='PENDING';
alter table public.scheduled_messages enable row level security;
revoke all on public.scheduled_messages from anon,authenticated;
grant select on public.scheduled_messages to authenticated;
create policy scheduled_own on public.scheduled_messages for select to authenticated using(author_id=auth.uid() and private.is_member(organization_id) and private.can_thread(thread_id));
create function public.schedule_message(p_org uuid,p_thread uuid,p_client uuid,p_body text,p_when timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not private.can_thread(p_thread) or not exists(select 1 from public.message_threads where id=p_thread and organization_id=p_org and kind='dm') then raise insufficient_privilege; end if;
 select id into result from public.scheduled_messages where thread_id=p_thread and author_id=auth.uid() and client_message_id=p_client;
 if result is not null then return result;end if;
 if p_when is null or p_when<now()+interval '1 minute' or p_when>now()+interval '30 days' or p_body is null or length(trim(p_body)) not between 1 and 10000 then raise check_violation;end if;
 insert into public.scheduled_messages(organization_id,thread_id,author_id,client_message_id,body,send_at) values(p_org,p_thread,auth.uid(),p_client,trim(p_body),p_when) on conflict(thread_id,author_id,client_message_id) do update set client_message_id=excluded.client_message_id returning id into result;
 return result;
end $$;
create function public.cancel_scheduled_message(p_org uuid,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_member(p_org) then raise insufficient_privilege;end if;
 update public.scheduled_messages set status='CANCELLED' where id=p_id and organization_id=p_org and author_id=auth.uid() and status='PENDING';
 if not found then raise exception 'Scheduled message is no longer pending' using errcode='40001';end if;
end $$;
-- Database-owned, bounded, transactional delivery. No browser session or forged JWT.
create function public.deliver_scheduled_messages() returns integer language plpgsql security definer set search_path='' as $$
declare job public.scheduled_messages; count_sent integer:=0; mid uuid;
begin
 for job in select * from public.scheduled_messages where status='PENDING' and send_at<=now() order by send_at limit 50 for update skip locked loop
  perform 1 from public.thread_members tm join public.organization_members om on om.organization_id=tm.organization_id and om.user_id=tm.user_id join public.profiles p on p.id=tm.user_id where tm.thread_id=job.thread_id order by om.user_id for share of om,p;
  if not exists(select 1 from public.thread_members tm join public.organization_members om on om.organization_id=tm.organization_id and om.user_id=tm.user_id join public.profiles p on p.id=tm.user_id where tm.thread_id=job.thread_id and tm.user_id=job.author_id and om.state='ACTIVE' and p.status='ACTIVE')
   or not exists(select 1 from auth.identities where user_id=job.author_id and provider='google')
   or exists(select 1 from public.thread_members tm join public.organization_members om on om.organization_id=tm.organization_id and om.user_id=tm.user_id join public.profiles p on p.id=tm.user_id where tm.thread_id=job.thread_id and (om.state<>'ACTIVE' or p.status<>'ACTIVE')) then
   update public.scheduled_messages set status='FAILED' where id=job.id;continue;
  end if;
  insert into public.messages(thread_id,author_id,body,client_message_id) values(job.thread_id,job.author_id,job.body,job.client_message_id) on conflict(thread_id,author_id,client_message_id) where client_message_id is not null do nothing returning id into mid;
  if mid is not null then
   update public.thread_members set last_message_at=now() where thread_id=job.thread_id;
   insert into public.notifications(organization_id,user_id,body,target) select job.organization_id,user_id,'New direct message','/messages/'||job.thread_id::text from public.thread_members where thread_id=job.thread_id and user_id<>job.author_id;
  end if;
  update public.scheduled_messages set status='SENT' where id=job.id;count_sent:=count_sent+1;
 end loop;return count_sent;
end $$;
revoke all on function public.schedule_message(uuid,uuid,uuid,text,timestamptz),public.cancel_scheduled_message(uuid,uuid),public.deliver_scheduled_messages() from public,anon,authenticated;
grant execute on function public.schedule_message(uuid,uuid,uuid,text,timestamptz),public.cancel_scheduled_message(uuid,uuid) to authenticated;
grant execute on function public.deliver_scheduled_messages() to service_role;

-- Signed provider events only. Store minimal metadata, never full event bodies/tokens.
create table private.livekit_events(id text primary key,event text not null,occurred_at timestamptz not null,received_at timestamptz not null default now());
alter table public.meetings add column provider_room_sid text,add column provider_event_at timestamptz;
alter table public.meeting_presence add column disconnected_at timestamptz,add column provider_sid text;
create function public.record_livekit_event(p_id text,p_event text,p_room text,p_sid text,p_identity uuid,p_participant_sid text,p_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare m public.meetings;
begin
 insert into private.livekit_events(id,event,occurred_at) values(p_id,p_event,p_at) on conflict do nothing;if not found then return;end if;
 select * into m from public.meetings where room_name=p_room for update;if m.id is null then return;end if;
 if p_event='room_started' then
  if m.provider_event_at is null or p_at>m.provider_event_at then update public.meetings set provider_room_sid=p_sid,provider_event_at=p_at where id=m.id;end if;
  if m.status<>'LIVE' then insert into private.media_operations(meeting_id,operation) values(m.id,'END');end if;
 elsif p_event in ('participant_joined','participant_left') then
  if not exists(select 1 from public.meeting_members where meeting_id=m.id and user_id=p_identity) then return;end if;
  if p_event='participant_joined' then
   if m.status<>'LIVE' or now()>m.ends_at or not exists(select 1 from public.meeting_members mm join public.organization_members om on om.user_id=mm.user_id and om.organization_id=mm.organization_id join public.profiles p on p.id=mm.user_id where mm.meeting_id=m.id and mm.user_id=p_identity and mm.removed_at is null and mm.admitted_at is not null and om.state='ACTIVE' and p.status='ACTIVE') then insert into private.media_operations(meeting_id,user_id,operation) values(m.id,p_identity,'REMOVE');return;end if;
   insert into public.meeting_presence(meeting_id,user_id,connected_at,last_seen_at,provider_sid) values(m.id,p_identity,p_at,p_at,p_participant_sid) on conflict(meeting_id,user_id) do update set connected_at=excluded.connected_at,last_seen_at=excluded.last_seen_at,provider_sid=excluded.provider_sid,disconnected_at=null where public.meeting_presence.last_seen_at<=p_at;
  else
   update public.meeting_presence set disconnected_at=p_at,last_seen_at=p_at where meeting_id=m.id and user_id=p_identity and provider_sid=p_participant_sid and last_seen_at<=p_at;
  end if;
 elsif p_event='room_finished' and m.provider_room_sid=p_sid and m.provider_event_at<=p_at then
  -- SFU rooms can empty during a network outage: keep the business meeting rejoinable.
  update public.meetings set provider_event_at=p_at where id=m.id;
  update public.meeting_presence set disconnected_at=p_at,last_seen_at=p_at where meeting_id=m.id and last_seen_at<=p_at;
 end if;
end $$;
create function public.expire_live_meetings() returns integer language plpgsql security definer set search_path='' as $$
declare m public.meetings; n integer:=0;
begin
 for m in select * from public.meetings where status='LIVE' and ends_at<now() limit 50 for update skip locked loop
  update public.meetings set status='ENDED',version=version+1 where id=m.id;
  update public.meeting_members set admitted_at=null where meeting_id=m.id;
  insert into private.media_operations(meeting_id,operation) values(m.id,'END');n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.record_livekit_event(text,text,text,text,uuid,text,timestamptz),public.expire_live_meetings() from public,anon,authenticated;
grant execute on function public.record_livekit_event(text,text,text,text,uuid,text,timestamptz),public.expire_live_meetings() to service_role;
commit;
