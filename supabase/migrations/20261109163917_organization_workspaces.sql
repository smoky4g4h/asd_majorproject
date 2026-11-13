begin;
alter table public.organizations add column icon text not null default 'orange' check(icon in ('orange','purple','blue','green','pink','teal'));
-- Intentionally narrow auth projection: auth.users itself remains inaccessible.
create function public.workspace_directory(p_org uuid) returns table(user_id uuid,full_name text,email text,avatar_url text,role public.app_role,state text,created_at timestamptz,mfa_enabled boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_member(p_org) then raise exception 'access_denied' using errcode='42501'; end if;
 return query select m.user_id,coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(p.full_name,''),'Workspace member'),
 case when m.user_id=auth.uid() or private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) then u.email else null end,
 coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture',p.avatar_path),m.role,
 case when p.status='ACTIVE' then m.state else 'DISABLED' end,m.created_at,
 case when m.user_id=auth.uid() or private.has_role(p_org,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) then exists(select 1 from auth.mfa_factors f where f.user_id=m.user_id and f.status='verified') else null end
 from public.organization_members m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id where m.organization_id=p_org;
end $$;
create function public.create_organization(p_source uuid,p_name text,p_icon text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not private.has_role(p_source,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) then raise exception 'access_denied' using errcode='42501'; end if;
 if length(trim(p_name)) not between 1 and 160 then raise exception 'invalid name' using errcode='22023'; end if;
 insert into public.organizations(name,icon) values(trim(p_name),p_icon) returning id into result;
 insert into public.organization_members(organization_id,user_id,role) values(result,auth.uid(),'ORG_ADMIN');
 return result;
end $$;
create function public.manage_organization_member(p_source uuid,p_target uuid,p_user uuid,p_role public.app_role,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_user=auth.uid() or p_role='PLATFORM_ADMIN' or not private.has_role(p_source,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) or not private.has_role(p_target,array['PLATFORM_ADMIN','ORG_ADMIN']::public.app_role[]) then raise exception 'access_denied' using errcode='42501'; end if;
 -- Serialize membership changes against this organization and protect platform admins.
 perform 1 from public.organizations where id=p_target for update;
 if not exists(select 1 from public.organization_members where organization_id=p_source and user_id=p_user) or exists(select 1 from public.organization_members where organization_id=p_target and user_id=p_user and role='PLATFORM_ADMIN') or not exists(select 1 from public.profiles where id=p_user and status='ACTIVE') then raise exception 'access_denied' using errcode='42501'; end if;
 if exists(select 1 from public.meeting_members mm join public.meetings mt on mt.id=mm.meeting_id where mm.organization_id=p_target and mm.user_id=p_user and mm.removed_at is null and mt.status='LIVE') then raise exception 'End this member’s live meetings before changing access' using errcode='22023'; end if;
 insert into public.organization_members(organization_id,user_id,role,state) values(p_target,p_user,p_role,case when p_active then 'ACTIVE' else 'DISABLED' end)
 on conflict(organization_id,user_id) do update set role=excluded.role,state=excluded.state;
end $$;
revoke all on function public.workspace_directory(uuid),public.create_organization(uuid,text,text),public.manage_organization_member(uuid,uuid,uuid,public.app_role,boolean) from public,anon;
grant execute on function public.workspace_directory(uuid),public.create_organization(uuid,text,text),public.manage_organization_member(uuid,uuid,uuid,public.app_role,boolean) to authenticated;
-- Provision the two requested reference groups only for existing platform admins.
-- No other users, private records or meetings are copied into these groups.
do $$ declare source uuid; target uuid; label text; glyph text; begin
 select m.organization_id into source from public.organization_members m where m.role='PLATFORM_ADMIN' and m.state='ACTIVE' order by m.created_at limit 1;
 if source is not null then
  for label,glyph in select * from (values ('Design Studio','purple'),('Project Studio','blue')) as presets(name,icon) loop
   insert into public.organizations(name,icon) values(label,glyph) returning id into target;
   insert into public.organization_members(organization_id,user_id,role) select target,user_id,'ORG_ADMIN' from public.organization_members where organization_id=source and role='PLATFORM_ADMIN' and state='ACTIVE';
  end loop;
 end if;
end $$;
-- A note title is unique within its organization, never across workspaces.
alter table public.notes drop constraint notes_author_id_title_key;
alter table public.notes add constraint notes_organization_author_title_key unique(organization_id,author_id,title);
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.workspace_mutate(uuid,jsonb)'::regprocedure);
 if position('on conflict(author_id,title)' in definition)=0 then raise exception 'Unexpected workspace_mutate definition'; end if;
 execute replace(definition,'on conflict(author_id,title)','on conflict(organization_id,author_id,title)');
end $$;
commit;
