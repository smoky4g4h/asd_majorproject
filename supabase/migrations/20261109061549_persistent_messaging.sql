begin;
alter table public.message_threads add column dm_key text;
create unique index dm_pair_unique on public.message_threads(organization_id,dm_key) where dm_key is not null;
alter table public.messages add column client_message_id uuid;
create unique index message_retry_unique on public.messages(thread_id,author_id,client_message_id) where client_message_id is not null;
create or replace function private.can_thread(tid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.message_threads t where t.id=tid and private.is_member(t.organization_id) and
 (t.kind='meeting' and exists(select 1 from public.meeting_members mm join public.meetings m on m.id=mm.meeting_id where m.id=t.meeting_id and mm.user_id=auth.uid() and mm.admitted_at is not null and mm.removed_at is null and mm.invitation_status<>'DECLINED' and m.status='LIVE' and now()<=m.ends_at)
 or t.kind<>'meeting' and exists(select 1 from public.thread_members mm where mm.thread_id=t.id and mm.user_id=auth.uid())));
$$;
create function public.open_direct_thread(p_org uuid,p_recipient uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare pair text; tid uuid;
begin
 perform private.require_member(p_org);
 if p_recipient=auth.uid() or not exists(select 1 from public.organization_members m join public.profiles p on p.id=m.user_id where m.organization_id=p_org and m.user_id=p_recipient and m.state='ACTIVE' and p.status='ACTIVE') then raise insufficient_privilege;end if;
 pair:=least(auth.uid(),p_recipient)::text||':'||greatest(auth.uid(),p_recipient)::text;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||pair,0));
 select id into tid from public.message_threads where organization_id=p_org and dm_key=pair;
 if tid is null then
  select t.id into tid from public.message_threads t where t.organization_id=p_org and t.kind='dm' and (select count(*) from public.thread_members m where m.thread_id=t.id)=2 and exists(select 1 from public.thread_members m where m.thread_id=t.id and m.user_id=auth.uid()) and exists(select 1 from public.thread_members m where m.thread_id=t.id and m.user_id=p_recipient) order by t.created_at,t.id limit 1;
  if tid is null then
   insert into public.message_threads(organization_id,kind,creator_id,dm_key) values(p_org,'dm',auth.uid(),pair) returning id into tid;
   insert into public.thread_members(thread_id,organization_id,user_id) values(tid,p_org,auth.uid()),(tid,p_org,p_recipient);
  else update public.message_threads set dm_key=pair where id=tid;end if;
 end if;
 return tid;
end $$;
create function public.send_message(p_thread uuid,p_client uuid,p_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare msg public.messages; t public.message_threads;
begin
 select * into t from public.message_threads where id=p_thread for update;
 if not private.can_thread(p_thread) then raise insufficient_privilege;end if;
 if p_client is null or p_body is null or length(trim(p_body)) not between 1 and 10000 then raise check_violation;end if;
 select * into msg from public.messages where thread_id=p_thread and author_id=auth.uid() and client_message_id=p_client;
 if msg.id is not null then return to_jsonb(msg);end if;
 insert into public.messages(thread_id,author_id,body,client_message_id) values(p_thread,auth.uid(),trim(p_body),p_client) returning * into msg;
 update public.thread_members set last_message_at=msg.created_at where thread_id=p_thread;
 if t.kind='dm' then
  insert into public.notifications(organization_id,user_id,body,target)
  select t.organization_id,m.user_id,'New direct message','/messages/'||p_thread::text from public.thread_members m join public.organization_members om on om.organization_id=m.organization_id and om.user_id=m.user_id where m.thread_id=p_thread and m.user_id<>auth.uid() and om.state='ACTIVE';
 end if;
 return to_jsonb(msg);
end $$;
create function public.list_messages(p_thread uuid,p_before uuid default null) returns setof public.messages language plpgsql security definer set search_path='' as $$
declare cursor_row public.messages;
begin
 if not private.can_thread(p_thread) then raise insufficient_privilege;end if;
 if p_before is not null then
  select * into cursor_row from public.messages where id=p_before and thread_id=p_thread;
  if cursor_row.id is null then raise no_data_found;end if;
 end if;
 return query select m.* from public.messages m where m.thread_id=p_thread and (p_before is null or (m.created_at,m.id)<(cursor_row.created_at,cursor_row.id)) order by m.created_at desc,m.id desc limit 51;
end $$;
revoke all on function public.open_direct_thread(uuid,uuid),public.send_message(uuid,uuid,text),public.list_messages(uuid,uuid) from public,anon;
grant execute on function public.open_direct_thread(uuid,uuid),public.send_message(uuid,uuid,text),public.list_messages(uuid,uuid) to authenticated;
create function public.read_conversation(p_thread uuid,p_message uuid) returns void language plpgsql security definer set search_path='' as $$
declare seen timestamptz;
begin
 if not private.can_thread(p_thread) then raise insufficient_privilege;end if;
 select created_at into seen from public.messages where id=p_message and thread_id=p_thread;
 if seen is null then raise no_data_found;end if;
 update public.thread_members set read_at=greatest(coalesce(read_at,seen),seen) where thread_id=p_thread and user_id=auth.uid();
 update public.notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and target='/messages/'||p_thread::text and created_at<=seen;
end $$;
revoke all on function public.read_conversation(uuid,uuid) from public,anon;
grant execute on function public.read_conversation(uuid,uuid) to authenticated;
commit;
