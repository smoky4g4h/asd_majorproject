begin;
create function private.require_member(org uuid) returns void language plpgsql security definer set search_path='' as $$ begin if not private.is_member(org) then raise insufficient_privilege using message='access_denied';end if;end $$;
create function private.audit(org uuid,verb text,rid uuid,detail jsonb default '{}') returns void language sql security definer set search_path='' as $$ insert into public.audit_events(organization_id,actor_id,action,resource_id,details) values(org,auth.uid(),verb,rid,detail) $$;
create function public.consume_rate_limit(p_key text) returns void language plpgsql security definer set search_path='' as $$ declare n integer;begin if auth.uid() is null then raise insufficient_privilege;end if;insert into private.rate_limits(actor_id,key,bucket) values(auth.uid(),left(p_key,80),date_trunc('minute',now())) on conflict(actor_id,key,bucket) do update set hits=private.rate_limits.hits+1 returning hits into n;if n>90 then raise exception 'rate_limit';end if;delete from private.rate_limits where bucket<now()-interval '1 day';end $$;
create function public.create_invitation(p_org uuid,p_email text,p_role public.app_role) returns public.invitations language plpgsql security definer set search_path='' as $$ declare result public.invitations;begin if not private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) or p_role='PLATFORM_ADMIN' then raise insufficient_privilege;end if;if p_role='ORG_ADMIN' and not private.has_role(p_org,array['PLATFORM_ADMIN']::public.app_role[]) then raise insufficient_privilege;end if;update public.invitations set status='REVOKED' where organization_id=p_org and email=lower(trim(p_email)) and status='PENDING' and expires_at<=now();insert into public.invitations(organization_id,email,role,inviter_id) values(p_org,lower(trim(p_email)),p_role,auth.uid()) returning * into result;perform private.audit(p_org,'invitation.created',result.id);return result;end $$;
create function public.accept_invitation() returns uuid language plpgsql security definer set search_path='' as $$ declare inv public.invitations;begin if auth.uid() is null then raise insufficient_privilege;end if;select * into inv from public.invitations where auth_user_id=auth.uid() and email=lower(auth.jwt()->>'email') and status='PENDING' and expires_at>now() order by created_at desc limit 1 for update;if inv.id is null then raise exception 'No valid invitation' using errcode='42501';end if;if inv.role in ('ORG_ADMIN','ORGANIZER','PLATFORM_ADMIN') and auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'MFA_REQUIRED' using errcode='42501';end if;insert into public.organization_members(organization_id,user_id,role) values(inv.organization_id,auth.uid(),inv.role) on conflict(organization_id,user_id) do nothing;update public.invitations set status='ACCEPTED' where id=inv.id;perform private.audit(inv.organization_id,'invitation.accepted',inv.id);return inv.organization_id;end $$;
create function public.manage_member(p_org uuid,p_user uuid,p_role public.app_role,p_active boolean) returns void language plpgsql security definer set search_path='' as $$ declare old public.organization_members;begin if not private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) then raise insufficient_privilege;end if;-- Serialize last-admin decisions across organizations.
perform pg_advisory_xact_lock(732458);select * into old from public.organization_members where organization_id=p_org and user_id=p_user for update;if old.user_id is null then raise no_data_found;end if;if (old.role in ('PLATFORM_ADMIN','ORG_ADMIN') or p_role in ('PLATFORM_ADMIN','ORG_ADMIN')) and not private.has_role(p_org,array['PLATFORM_ADMIN']::public.app_role[]) then raise insufficient_privilege;end if;if old.role='PLATFORM_ADMIN' and old.state='ACTIVE' and (not p_active or p_role<>'PLATFORM_ADMIN') and (select count(*) from public.organization_members where role='PLATFORM_ADMIN' and state='ACTIVE')<=1 then raise exception 'Last platform admin' using errcode='23514';end if;if p_user=auth.uid() and not p_active then raise exception 'Cannot deactivate self' using errcode='23514';end if;update public.organization_members set role=p_role,state=case when p_active then 'ACTIVE' else 'DISABLED' end where organization_id=p_org and user_id=p_user;if not p_active then update public.meeting_members set removed_at=now(),admitted_at=null where organization_id=p_org and user_id=p_user;insert into private.media_operations(meeting_id,user_id,operation) select mm.meeting_id,p_user,'REMOVE' from public.meeting_members mm join public.meetings m on m.id=mm.meeting_id where mm.organization_id=p_org and mm.user_id=p_user and m.status='LIVE';end if;perform private.audit(p_org,'member.updated',p_user,jsonb_build_object('role',p_role,'active',p_active));end $$;
create function public.revoke_invitation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ declare org uuid;begin select organization_id into org from public.invitations where id=p_id for update;if not private.has_role(org,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) then raise insufficient_privilege;end if;update public.invitations set status='REVOKED' where id=p_id and status='PENDING';perform private.audit(org,'invitation.revoked',p_id);end $$;
create function public.update_profile(p_name text) returns void language plpgsql security definer set search_path='' as $$ begin if auth.uid() is null then raise insufficient_privilege;end if;update public.profiles set full_name=trim(p_name) where id=auth.uid() and status='ACTIVE';end $$;
-- These functions validate the caller independently of the API. No caller-provided identity is trusted.
create function public.workspace_mutate(p_org uuid,p_action jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare kind text:=p_action->>'type'; item jsonb; rid uuid; old_task public.tasks; old_meeting public.meetings; old_doc public.documents; person uuid; v text; folder uuid; idx integer:=0; old_ids uuid[];
begin
 perform private.require_member(p_org);
 if kind='task' then
  item:=p_action->'task';rid:=coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());select * into old_task from public.tasks where id=rid for update;
  if old_task.id is not null then if old_task.organization_id<>p_org or not private.can_task(rid) then raise insufficient_privilege;end if;
  elsif not private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN','ORGANIZER','MEMBER']::public.app_role[]) then raise insufficient_privilege;end if;
  if nullif(item->>'meetingId','') is not null and not private.can_meeting((item->>'meetingId')::uuid) then raise insufficient_privilege;end if;
  old_ids:=array(select user_id from public.task_assignees where task_id=rid);
  insert into public.tasks(id,organization_id,creator_id,meeting_id,title,description,status,priority,due_at,archived_at) values(rid,p_org,auth.uid(),nullif(item->>'meetingId','')::uuid,trim(item->>'title'),coalesce(item->>'description',''),coalesce(item->>'status','To-do'),coalesce(item->>'priority','Medium'),nullif(item->>'due','')::timestamptz,case when (item->>'archived')::boolean then now() end) on conflict(id) do update set title=excluded.title,description=excluded.description,status=excluded.status,priority=excluded.priority,due_at=excluded.due_at,meeting_id=excluded.meeting_id,archived_at=excluded.archived_at,updated_at=now();
  -- Members may update their task but cannot reassign it to other people.
  if not private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN','ORGANIZER']::public.app_role[]) and exists(select 1 from jsonb_array_elements_text(coalesce(item->'collaboratorIds','[]')||case when nullif(item->>'assignee','') is null then '[]'::jsonb else jsonb_build_array(item->>'assignee') end) x where x::uuid<>auth.uid() and not(x::uuid=any(old_ids))) then raise insufficient_privilege;end if;
  delete from public.task_assignees where task_id=rid;
  for person in select distinct x::uuid from jsonb_array_elements_text(coalesce(item->'collaboratorIds','[]')||case when nullif(item->>'assignee','') is null then '[]'::jsonb else jsonb_build_array(item->>'assignee') end) x loop
   if not exists(select 1 from public.organization_members om join public.profiles p on p.id=om.user_id where om.organization_id=p_org and om.user_id=person and om.state='ACTIVE' and p.status='ACTIVE') then raise insufficient_privilege;end if;
   insert into public.task_assignees(task_id,organization_id,user_id) values(rid,p_org,person);
   if person<>auth.uid() and not(person=any(old_ids)) then insert into public.notifications(organization_id,user_id,body,target) values(p_org,person,'Task assigned: '||(item->>'title'),'/tasks?task='||rid::text);end if;
  end loop;
  delete from public.task_checklist_items where task_id=rid;
  for item in select value from jsonb_array_elements(coalesce(item->'checklist','[]')) loop
   insert into public.task_checklist_items(task_id,body,done,position) values(rid,item->>'text',coalesce((item->>'done')::boolean,false),idx);idx:=idx+1;
  end loop;
 elsif kind='meeting' then
  item:=p_action->'meeting';rid:=coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());select * into old_meeting from public.meetings where id=rid for update;
  if old_meeting.id is null then if not private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN','ORGANIZER']::public.app_role[]) then raise insufficient_privilege;end if;
  else if old_meeting.organization_id<>p_org or not private.is_host(rid) then raise insufficient_privilege;end if;if old_meeting.status in ('ENDED','CANCELLED') then raise exception 'Meeting closed' using errcode='23514';end if;end if;
  insert into public.meetings(id,organization_id,organizer_id,title,description,agenda,starts_at,ends_at,timezone) values(rid,p_org,auth.uid(),trim(item->>'title'),coalesce(item->>'description',''),coalesce(item->'agenda','[]'),(item->>'startAt')::timestamptz,(item->>'endAt')::timestamptz,coalesce(item->>'timezone','UTC')) on conflict(id) do update set title=excluded.title,description=excluded.description,agenda=excluded.agenda,starts_at=excluded.starts_at,ends_at=excluded.ends_at,timezone=excluded.timezone,version=public.meetings.version+1;
  insert into public.meeting_members(meeting_id,organization_id,user_id,meeting_role,invitation_status,admitted_at) values(rid,p_org,coalesce(old_meeting.organizer_id,auth.uid()),'HOST','ACCEPTED',now()) on conflict(meeting_id,user_id) do nothing;
  for person in select distinct x::uuid from jsonb_array_elements_text(item->'participantIds') x loop
   if not exists(select 1 from public.organization_members om join public.profiles p on p.id=om.user_id where om.organization_id=p_org and om.user_id=person and om.state='ACTIVE' and p.status='ACTIVE') then raise insufficient_privilege;end if;
   insert into public.meeting_members(meeting_id,organization_id,user_id) values(rid,p_org,person) on conflict(meeting_id,user_id) do nothing;
   if person<>auth.uid() then insert into public.notifications(organization_id,user_id,body,target) values(p_org,person,case when old_meeting.id is null then 'Invitation: ' else 'Meeting updated: ' end||(item->>'title'),'/meetings/'||rid::text);end if;
  end loop;
  -- Removing existing participants is a separate revocation operation so live media is disconnected.
  insert into public.message_threads(organization_id,kind,meeting_id,creator_id,name) values(p_org,'meeting',rid,auth.uid(),item->>'title') on conflict(meeting_id) do nothing;
 elsif kind='rsvp' then
  rid:=(p_action->>'id')::uuid;if not private.can_meeting(rid) then raise insufficient_privilege;end if;
  update public.meeting_members set invitation_status=p_action->>'value' where meeting_id=rid and user_id=auth.uid();
 elsif kind='document' then
  item:=p_action->'document';rid:=coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());select * into old_doc from public.documents where id=rid for update;
  if old_doc.id is not null and (old_doc.organization_id<>p_org or not private.can_document(rid,true)) then raise insufficient_privilege;end if;
  if old_doc.id is null and not private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN','ORGANIZER','MEMBER']::public.app_role[]) then raise insufficient_privilege;end if;
  if nullif(item->>'meetingId','') is not null and not private.can_meeting((item->>'meetingId')::uuid) then raise insufficient_privilege;end if;
  if old_doc.id is not null and old_doc.owner_id<>auth.uid() then
   update public.documents set body=coalesce(item->>'content',''),name=trim(item->>'name'),updated_at=now() where id=rid;
  else
   if nullif(item->>'folder','') is not null then select id into folder from public.folders where organization_id=p_org and owner_id=auth.uid() and name=item->>'folder' and parent_id is null limit 1;if folder is null then insert into public.folders(organization_id,owner_id,name) values(p_org,auth.uid(),item->>'folder') returning id into folder;end if;end if;
   insert into public.documents(id,organization_id,owner_id,meeting_id,folder_id,name,body,size,kind,deleted_at) values(rid,p_org,auth.uid(),nullif(item->>'meetingId','')::uuid,folder,trim(item->>'name'),coalesce(item->>'content',''),octet_length(coalesce(item->>'content','')),coalesce(item->>'kind','document'),case when (item->>'deleted')::boolean then now() end) on conflict(id) do update set name=excluded.name,body=excluded.body,size=case when public.documents.storage_path is null then excluded.size else public.documents.size end,folder_id=excluded.folder_id,meeting_id=excluded.meeting_id,deleted_at=excluded.deleted_at,updated_at=now();
   delete from public.document_access where document_id=rid;
   for person in select distinct x::uuid from jsonb_array_elements_text(coalesce(item->'selected','[]')) x loop
    if not exists(select 1 from public.organization_members om join public.profiles p on p.id=om.user_id where om.organization_id=p_org and om.user_id=person and om.state='ACTIVE' and p.status='ACTIVE') then raise insufficient_privilege;end if;
    insert into public.document_access(document_id,organization_id,user_id,permission) values(rid,p_org,person,'reader');
   end loop;
  end if;
  if coalesce((item->>'favorite')::boolean,false) then insert into public.favorites(document_id,user_id) values(rid,auth.uid()) on conflict do nothing;else delete from public.favorites where document_id=rid and user_id=auth.uid();end if;
 elsif kind='delete-document' then
  rid:=(p_action->>'id')::uuid;update public.documents set deleted_at=now() where id=rid and organization_id=p_org and owner_id=auth.uid();if not found then raise insufficient_privilege;end if;
 elsif kind='read' then
  rid:=nullif(p_action->>'id','all')::uuid;update public.notifications set read_at=now() where organization_id=p_org and user_id=auth.uid() and (rid is null or id=rid);
 elsif kind='note' then
  if length(p_action->>'key')>240 or length(p_action->>'value')>100000 then raise check_violation;end if;
  insert into public.notes(organization_id,author_id,title,body) values(p_org,auth.uid(),p_action->>'key',p_action->>'value') on conflict(author_id,title) do update set body=excluded.body,updated_at=now() returning id into rid;
 else raise exception 'Unsupported mutation' using errcode='22023';end if;
 perform private.audit(p_org,kind||'.saved',rid);return rid;
end $$;
create function public.meeting_action(p_id uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.meetings; member public.meeting_members; req public.admission_requests; target uuid; op uuid;
begin
 select * into m from public.meetings where id=p_id for update;if m.id is null or not private.can_meeting(p_id) then raise insufficient_privilege;end if;
 select * into member from public.meeting_members where meeting_id=p_id and user_id=auth.uid();
 if p_action='admission-request' then
  if m.status in ('CANCELLED','ENDED') or now()>m.ends_at or now()<m.starts_at-interval '30 minutes' or member.invitation_status='DECLINED' then raise exception 'Outside admission window' using errcode='23514';end if;
  insert into public.admission_requests(meeting_id,user_id) values(p_id,auth.uid()) on conflict(meeting_id,user_id) do nothing;
 elsif p_action='room-access' then
  if m.status<>'LIVE' or now()<m.starts_at-interval '30 minutes' or now()>m.ends_at or member.admitted_at is null or member.removed_at is not null or member.invitation_status='DECLINED' then raise insufficient_privilege;end if;
  return jsonb_build_object('roomName',m.room_name,'identity',auth.uid(),'meetingRole',member.meeting_role,'version',m.version);
 else
  if not private.is_host(p_id) then raise insufficient_privilege;end if;
  if p_action='start' then
   if m.status<>'SCHEDULED' or now()<m.starts_at-interval '30 minutes' or now()>m.ends_at then raise check_violation;end if;
   update public.meetings set status='LIVE',version=version+1 where id=p_id;
  elsif p_action in ('approve','reject') then
   select * into req from public.admission_requests where id=(p_data->>'requestId')::uuid and meeting_id=p_id for update;if req.id is null or req.status<>'PENDING' or m.status<>'LIVE' then raise check_violation;end if;
   if not exists(select 1 from public.meeting_members mm join public.organization_members om on om.organization_id=mm.organization_id and om.user_id=mm.user_id join public.profiles p on p.id=om.user_id where mm.meeting_id=p_id and mm.user_id=req.user_id and mm.removed_at is null and om.state='ACTIVE' and p.status='ACTIVE') then raise insufficient_privilege;end if;
   update public.admission_requests set status=case when p_action='approve' then 'APPROVED' else 'REJECTED' end,decided_by=auth.uid(),decided_at=now() where id=req.id;
   if p_action='approve' then update public.meeting_members set admitted_at=now() where meeting_id=p_id and user_id=req.user_id;end if;
  elsif p_action in ('remove-participant','mute-participant') then
   target:=(p_data->>'userId')::uuid;if target=m.organizer_id or not exists(select 1 from public.meeting_members where meeting_id=p_id and user_id=target) then raise check_violation;end if;
   if p_action='remove-participant' then update public.meeting_members set removed_at=now(),admitted_at=null where meeting_id=p_id and user_id=target;update public.admission_requests set status='REJECTED',decided_by=auth.uid(),decided_at=now() where meeting_id=p_id and user_id=target;end if;
   insert into private.media_operations(meeting_id,user_id,operation) values(p_id,target,case when p_action='remove-participant' then 'REMOVE' else 'MUTE' end) returning id into op;
  elsif p_action in ('end','cancel') then
   update public.meetings set status=case when p_action='end' then 'ENDED' else 'CANCELLED' end,version=version+1 where id=p_id;
   update public.meeting_members set admitted_at=null where meeting_id=p_id;
   insert into private.media_operations(meeting_id,operation) values(p_id,'END') returning id into op;
   insert into public.notifications(organization_id,user_id,body,target) select m.organization_id,user_id,'Meeting '||p_action||': '||m.title,'/meetings/'||p_id::text from public.meeting_members where meeting_id=p_id;
  else raise invalid_parameter_value;end if;
 end if;
 perform private.audit(m.organization_id,'meeting.'||p_action,p_id);return jsonb_build_object('id',p_id,'roomName',m.room_name,'operationId',op);
end $$;
create function public.complete_media_operation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$ declare mid uuid;begin select meeting_id into mid from private.media_operations where id=p_id;if not private.is_host(mid) then raise insufficient_privilege;end if;update private.media_operations set status='DONE' where id=p_id;end $$;
revoke all on all functions in schema private from public;
revoke all on function public.consume_rate_limit(text),public.create_invitation(uuid,text,public.app_role),public.accept_invitation(),public.manage_member(uuid,uuid,public.app_role,boolean),public.revoke_invitation(uuid),public.update_profile(text),public.workspace_mutate(uuid,jsonb),public.meeting_action(uuid,text,jsonb),public.complete_media_operation(uuid) from public;
grant execute on function public.consume_rate_limit(text),public.create_invitation(uuid,text,public.app_role),public.accept_invitation(),public.manage_member(uuid,uuid,public.app_role,boolean),public.revoke_invitation(uuid),public.update_profile(text),public.workspace_mutate(uuid,jsonb),public.meeting_action(uuid,text,jsonb),public.complete_media_operation(uuid) to authenticated;
commit;
