-- Supabase Auth uses varchar(255); RETURNS TABLE requires exact text type.
begin;
create or replace function public.workspace_directory(p_org uuid) returns table(user_id uuid,full_name text,email text,avatar_url text,role public.app_role,state text,created_at timestamptz,mfa_enabled boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_member(p_org) then raise exception 'access_denied' using errcode='42501'; end if;
 return query select m.user_id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(p.full_name,''),'Workspace member'),
 case when m.user_id=auth.uid() or private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) then u.email::text else null end,
 coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture',p.avatar_path),m.role,
 case when p.status='ACTIVE' then m.state else 'DISABLED' end,m.created_at,
 case when m.user_id=auth.uid() or private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) then exists(select 1 from auth.mfa_factors f where f.user_id=m.user_id and f.status='verified') else null end
 from public.organization_members m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id where m.organization_id=p_org;
end $$;
commit;
