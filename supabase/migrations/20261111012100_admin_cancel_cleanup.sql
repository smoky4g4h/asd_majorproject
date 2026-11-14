begin;
create or replace function public.complete_media_operation(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare mid uuid; org uuid; action text; meeting_status text;
begin
 select o.meeting_id,m.organization_id,o.operation,m.status into mid,org,action,meeting_status from private.media_operations o join public.meetings m on m.id=o.meeting_id where o.id=p_id;
 if not private.is_host(mid) and not (action='END' and meeting_status='CANCELLED' and private.has_role(org,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) and auth.jwt()->>'aal'='aal2') then raise insufficient_privilege;end if;
 update private.media_operations set status='DONE' where id=p_id;
end $$;
commit;
