begin;
-- This migration has not been deployed. Gmail needs a durable UNKNOWN state
-- because its send endpoint does not offer provider idempotency keys.
alter table public.invitations drop constraint invitations_delivery_status_check;
alter table public.invitations add constraint invitations_delivery_status_check check(delivery_status in ('PENDING','SENT','FAILED','UNKNOWN'));
-- Private outbox: payloads and provider IDs are never exposed to browser roles.
create table private.invitation_email_attempts (
 id uuid primary key default gen_random_uuid(),
 invitation_id uuid not null references public.invitations(id) on delete cascade,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 state text not null default 'SENDING' check(state in ('SENDING','SENT','FAILED','UNKNOWN')),
 lease uuid not null default gen_random_uuid(),
 lease_until timestamptz not null default now()+interval '60 seconds',
 provider_id text,
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz
);
create index invitation_email_attempts_latest on private.invitation_email_attempts(invitation_id,created_at desc,id desc);
alter table private.invitation_email_attempts enable row level security;
revoke all on private.invitation_email_attempts from public,anon,authenticated;

-- Service-only primitives. The server authenticates the administrator and scopes
-- the invitation before calling these; the functions repeat the organization check.
-- No transaction stays open while the external email provider is called.
create function public.claim_invitation_email(p_org uuid,p_invitation uuid,p_payload jsonb,p_resend boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare inv public.invitations; attempt private.invitation_email_attempts;
begin
 select * into inv from public.invitations where id=p_invitation for update;
 if inv.id is null or inv.organization_id is distinct from p_org then raise insufficient_privilege; end if;
 if inv.status<>'PENDING' or inv.expires_at<=now() or inv.auth_user_id is null then
  raise exception 'Invitation is closed or not prepared' using errcode='23514';
 end if;
 select * into attempt from private.invitation_email_attempts where invitation_id=inv.id order by created_at desc,id desc limit 1;
 if attempt.id is not null then
  if attempt.state='SENT' then
   if not coalesce(p_resend,false) then return jsonb_build_object('status','SENT'); end if;
   if attempt.finished_at>now()-interval '60 seconds' then raise exception 'email_resend_cooldown' using errcode='P0001'; end if;
   attempt.id:=null;
  else
   if attempt.state='UNKNOWN' then return jsonb_build_object('status','UNKNOWN'); end if;
   if attempt.state='SENDING' then
    if attempt.lease_until>now() then return jsonb_build_object('status','BUSY'); end if;
    update private.invitation_email_attempts set state='UNKNOWN' where id=attempt.id;
    update public.invitations set delivery_status='UNKNOWN' where id=inv.id;
    return jsonb_build_object('status','UNKNOWN');
   end if;
   -- FAILED records are known rejections or pre-send failures, so retry is safe.
   update private.invitation_email_attempts set state='SENDING',lease=gen_random_uuid(),lease_until=now()+interval '60 seconds',finished_at=null
    where id=attempt.id returning * into attempt;
  end if;
 end if;
 if attempt.id is null then
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload->'to' is distinct from jsonb_build_array(inv.email) then
   raise exception 'Invalid email recipient' using errcode='23514';
  end if;
  insert into private.invitation_email_attempts(invitation_id,payload) values(inv.id,p_payload) returning * into attempt;
 end if;
 update public.invitations set delivery_status='PENDING' where id=inv.id;
 return jsonb_build_object('status','CLAIMED','id',attempt.id,'lease',attempt.lease,'payload',attempt.payload);
end $$;

create function public.finish_invitation_email(p_org uuid,p_invitation uuid,p_attempt uuid,p_lease uuid,p_provider_id text,p_uncertain boolean default true)
returns boolean language plpgsql security definer set search_path='' as $$
declare inv public.invitations; attempt private.invitation_email_attempts;
begin
 select * into inv from public.invitations where id=p_invitation for update;
 if inv.id is null or inv.organization_id is distinct from p_org then raise insufficient_privilege; end if;
 if p_provider_id is not null and (length(p_provider_id)<1 or length(p_provider_id)>200) then raise exception 'Invalid provider ID' using errcode='23514'; end if;
 update private.invitation_email_attempts set state=case when p_provider_id is not null then 'SENT' when coalesce(p_uncertain,true) then 'UNKNOWN' else 'FAILED' end,
  provider_id=p_provider_id,finished_at=now()
  where id=p_attempt and invitation_id=inv.id and lease=p_lease and state in ('SENDING','UNKNOWN') returning * into attempt;
 if attempt.id is null then return false; end if;
 update public.invitations set delivery_status=case when p_provider_id is not null then 'SENT' when coalesce(p_uncertain,true) then 'UNKNOWN' else 'FAILED' end where id=inv.id;
 return true;
end $$;
revoke all on function public.claim_invitation_email(uuid,uuid,jsonb,boolean),public.finish_invitation_email(uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_invitation_email(uuid,uuid,jsonb,boolean),public.finish_invitation_email(uuid,uuid,uuid,uuid,text,boolean) to service_role;
commit;
