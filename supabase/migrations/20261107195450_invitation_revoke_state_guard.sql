begin;
create or replace function public.revoke_invitation(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare inv public.invitations;
begin
 select * into inv from public.invitations where id=p_id for update;
 if not private.has_role(inv.organization_id,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) then
  raise insufficient_privilege;
 end if;
 if inv.status='ACCEPTED' then
  raise exception 'Invitation already accepted; manage the membership instead' using errcode='23514';
 end if;
 if inv.status='REVOKED' then return; end if;
 update public.invitations set status='REVOKED' where id=p_id;
 perform private.audit(inv.organization_id,'invitation.revoked',p_id);
end $$;
revoke all on function public.revoke_invitation(uuid) from public,anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;
commit;
