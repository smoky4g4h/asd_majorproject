begin;
-- Match the server policy at the direct Data API boundary. Google must remain
-- the only enabled OAuth provider: AMR records OAuth, not the provider name.
-- Identity linkage comes from Auth-owned records, never user_metadata.
create function private.google_session() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
   and coalesce(auth.jwt()->'amr' @> '[{"method":"oauth"}]'::jsonb,false)
   and exists(select 1 from auth.identities i where i.user_id=auth.uid() and i.provider='google')
$$;
revoke all on function private.google_session() from public,anon;
grant execute on function private.google_session() to authenticated;

-- A restrictive policy composes with every existing ownership/org policy.
-- This includes self-profile and pre-membership views needed for Google MFA.
do $$ declare t text; begin
 foreach t in array array['profiles','organizations','organization_members','invitations','meetings','meeting_members','admission_requests','meeting_presence','tasks','task_assignees','task_comments','task_checklist_items','folders','documents','document_access','favorites','message_threads','thread_members','messages','notes','notifications','audit_events','calendar_events','calendar_preferences','user_preferences'] loop
  execute format('create policy google_session_required on public.%I as restrictive for select to authenticated using ((select private.google_session()))',t);
 end loop;
end $$;
create or replace function private.is_member(org uuid) returns boolean language sql stable security definer set search_path='' as $$ select private.google_session() and exists(select 1 from public.organization_members m join public.profiles p on p.id=m.user_id where m.organization_id=org and m.user_id=auth.uid() and m.state='ACTIVE' and p.status='ACTIVE' and (m.role in ('MEMBER','RESTRICTED_MEMBER') or auth.jwt()->>'aal'='aal2')) $$;
create or replace function public.consume_rate_limit(p_key text) returns void language plpgsql security definer set search_path='' as $$ declare n integer;begin if not private.google_session() then raise insufficient_privilege;end if;insert into private.rate_limits(actor_id,key,bucket) values(auth.uid(),left(p_key,80),date_trunc('minute',now())) on conflict(actor_id,key,bucket) do update set hits=private.rate_limits.hits+1 returning hits into n;if n>90 then raise exception 'rate_limit';end if;delete from private.rate_limits where bucket<now()-interval '1 day';end $$;
create or replace function public.accept_invitation() returns uuid language plpgsql security definer set search_path='' as $$ declare inv public.invitations;begin if not private.google_session() or not exists(select 1 from public.profiles where id=auth.uid() and status='ACTIVE') then raise insufficient_privilege;end if;select * into inv from public.invitations where auth_user_id=auth.uid() and email=lower(auth.jwt()->>'email') and status='PENDING' and expires_at>now() order by created_at desc limit 1 for update;if inv.id is null then raise exception 'No valid invitation' using errcode='42501';end if;if inv.role in ('ORG_ADMIN','ORGANIZER','PLATFORM_ADMIN') and auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'MFA_REQUIRED' using errcode='42501';end if;insert into public.organization_members(organization_id,user_id,role) values(inv.organization_id,auth.uid(),inv.role) on conflict(organization_id,user_id) do nothing;update public.invitations set status='ACCEPTED' where id=inv.id;perform private.audit(inv.organization_id,'invitation.accepted',inv.id);return inv.organization_id;end $$;
create or replace function public.update_profile(p_name text) returns void language plpgsql security definer set search_path='' as $$ begin if not private.google_session() then raise insufficient_privilege;end if;update public.profiles set full_name=trim(p_name) where id=auth.uid() and status='ACTIVE';end $$;
-- Preserve explicit non-anonymous RPC grants after replacement.
revoke all on function public.consume_rate_limit(text),public.accept_invitation(),public.update_profile(text) from public,anon;
grant execute on function public.consume_rate_limit(text),public.accept_invitation(),public.update_profile(text) to authenticated;
commit;
