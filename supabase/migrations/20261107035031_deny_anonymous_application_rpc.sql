-- Hosted Supabase default ACLs include explicit anon grants.
revoke execute on function public.consume_rate_limit(text) from public, anon;
revoke execute on function public.create_invitation(uuid,text,public.app_role) from public, anon;
revoke execute on function public.accept_invitation() from public, anon;
revoke execute on function public.manage_member(uuid,uuid,public.app_role,boolean) from public, anon;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
revoke execute on function public.update_profile(text) from public, anon;
revoke execute on function public.workspace_mutate(uuid,jsonb) from public, anon;
revoke execute on function public.meeting_action(uuid,text,jsonb) from public, anon;
revoke execute on function public.complete_media_operation(uuid) from public, anon;
