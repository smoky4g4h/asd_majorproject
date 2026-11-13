begin;
-- Preserve authenticated membership and host checks; retries reuse durable media jobs.
create or replace function public.meeting_action(p_id uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
  -- The meeting row lock serializes terminal transitions and retries.
  if m.status in ('ENDED','CANCELLED') then
   if (p_action='end' and m.status='ENDED') or (p_action='cancel' and m.status='CANCELLED') then
    select id into op from private.media_operations where meeting_id=p_id and operation='END' order by created_at desc,id desc limit 1;
    return jsonb_build_object('id',p_id,'roomName',m.room_name,'operationId',op);
   end if;
   raise check_violation;
  end if;
  if p_action='start' then
   if m.status<>'SCHEDULED' or now()<m.starts_at-interval '30 minutes' or now()>m.ends_at then raise check_violation;end if;
   update public.meetings set status='LIVE',version=version+1 where id=p_id;
  elsif p_action in ('approve','reject') then
   select * into req from public.admission_requests where id=(p_data->>'requestId')::uuid and meeting_id=p_id for update;if req.id is null or req.status<>'PENDING' or m.status<>'LIVE' then raise check_violation;end if;
   if not exists(select 1 from public.meeting_members mm join public.organization_members om on om.organization_id=mm.organization_id and om.user_id=mm.user_id join public.profiles p on p.id=om.user_id where mm.meeting_id=p_id and mm.user_id=req.user_id and mm.removed_at is null and om.state='ACTIVE' and p.status='ACTIVE') then raise insufficient_privilege;end if;
   update public.admission_requests set status=case when p_action='approve' then 'APPROVED' else 'REJECTED' end,decided_by=auth.uid(),decided_at=now() where id=req.id;
   if p_action='approve' then update public.meeting_members set admitted_at=now() where meeting_id=p_id and user_id=req.user_id;end if;
  elsif p_action in ('remove-participant','mute-participant') then
   if p_action='mute-participant' and m.status<>'LIVE' then raise check_violation;end if;
   target:=(p_data->>'userId')::uuid;if target=m.organizer_id or not exists(select 1 from public.meeting_members where meeting_id=p_id and user_id=target) then raise check_violation;end if;
   if p_action='remove-participant' and exists(select 1 from public.meeting_members where meeting_id=p_id and user_id=target and removed_at is not null) then
    select id into op from private.media_operations where meeting_id=p_id and user_id=target and operation='REMOVE' order by created_at desc,id desc limit 1;
    return jsonb_build_object('id',p_id,'roomName',m.room_name,'operationId',op);
   end if;
   if p_action='remove-participant' then update public.meeting_members set removed_at=now(),admitted_at=null where meeting_id=p_id and user_id=target;update public.admission_requests set status='REJECTED',decided_by=auth.uid(),decided_at=now() where meeting_id=p_id and user_id=target;end if;
   insert into private.media_operations(meeting_id,user_id,operation) values(p_id,target,case when p_action='remove-participant' then 'REMOVE' else 'MUTE' end) returning id into op;
  elsif p_action in ('end','cancel') then
   if (p_action='end' and m.status<>'LIVE') or (p_action='cancel' and m.status<>'SCHEDULED') then raise check_violation;end if;
   update public.meetings set status=case when p_action='end' then 'ENDED' else 'CANCELLED' end,version=version+1 where id=p_id;
   update public.meeting_members set admitted_at=null where meeting_id=p_id;
   insert into private.media_operations(meeting_id,operation) values(p_id,'END') returning id into op;
   insert into public.notifications(organization_id,user_id,body,target) select m.organization_id,user_id,'Meeting '||p_action||': '||m.title,'/meetings/'||p_id::text from public.meeting_members where meeting_id=p_id;
  else raise invalid_parameter_value;end if;
 end if;
 perform private.audit(m.organization_id,'meeting.'||p_action,p_id);return jsonb_build_object('id',p_id,'roomName',m.room_name,'operationId',op);
end $$;
revoke all on function public.meeting_action(uuid,text,jsonb) from public,anon;
grant execute on function public.meeting_action(uuid,text,jsonb) to authenticated;
commit;
