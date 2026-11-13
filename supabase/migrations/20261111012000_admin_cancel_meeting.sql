begin;
create function public.admin_cancel_meeting(p_org uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.meetings; op uuid; members jsonb;
begin
 if not private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) or auth.jwt()->>'aal' is distinct from 'aal2' then raise insufficient_privilege;end if;
 select * into m from public.meetings where id=p_id and organization_id=p_org for update;
 if m.id is null then raise insufficient_privilege;end if;
 if m.status<>'CANCELLED' then
  update public.meetings set status='CANCELLED',version=version+1 where id=p_id;
  update public.meeting_members set admitted_at=null where meeting_id=p_id;
  update public.admission_requests set status='REJECTED',decided_by=auth.uid(),decided_at=now() where meeting_id=p_id and status='PENDING';
  insert into private.media_operations(meeting_id,operation) values(p_id,'END') returning id into op;
  insert into public.notifications(organization_id,user_id,body,target) select p_org,user_id,'Meeting cancelled: '||m.title,'/meetings/'||p_id::text from public.meeting_members where meeting_id=p_id;
  perform private.audit(p_org,'meeting.cancel',p_id);
 else
  select id into op from private.media_operations where meeting_id=p_id and operation='END' order by created_at desc,id desc limit 1;
 end if;
 select coalesce(jsonb_agg(user_id),'[]'::jsonb) into members from public.meeting_members where meeting_id=p_id;
 return jsonb_build_object('id',p_id,'roomName',m.room_name,'operationId',op,'memberIds',members);
end $$;
revoke all on function public.admin_cancel_meeting(uuid,uuid) from public,anon;
grant execute on function public.admin_cancel_meeting(uuid,uuid) to authenticated;
commit;
