import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite,Transaction} from '@electric-sql/pglite';
import {createPolicyDatabase,asActor,uuid} from './helpers/db';
let db:PGlite;
const org=uuid(940),user=uuid(941),inv=uuid(942);
const payload={from:'invites@example.com',to:['guest@example.com'],subject:'Invite',text:'Google sign-in'};
beforeAll(async()=>{
 ({db}=await createPolicyDatabase());
 await db.query("insert into auth.users(id,email) values($1,'admin@example.com')",[user]);
 await db.query("insert into public.organizations(id,name) values($1,'Email fixture')",[org]);
 await db.query("insert into public.invitations(id,organization_id,email,role,inviter_id,auth_user_id) values($1,$2,'guest@example.com','MEMBER',$3,$3)",[inv,org,user]);
},30000);
afterAll(()=>db?.close());
const claim=async(tx:Transaction,resend=false,body=payload)=>
 (await tx.query<{result:any}>('select public.claim_invitation_email($1,$2,$3,$4) result',[org,inv,body,resend])).rows[0].result;
const finish=async(tx:Transaction,attempt:any,provider:string|null,uncertain=false)=>
 (await tx.query<{result:boolean}>('select public.finish_invitation_email($1,$2,$3,$4,$5,$6) result',[org,inv,attempt.id,attempt.lease,provider,uncertain])).rows[0].result;
async function scenario(run:(tx:Transaction)=>Promise<void>){await db.transaction(async tx=>{await run(tx);await tx.rollback();});}
it('restricts delivery RPCs and payloads to the server',async()=>{
 for(const role of ['anon','authenticated']){
  expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.claim_invitation_email(uuid,uuid,jsonb,boolean)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
  expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.finish_invitation_email(uuid,uuid,uuid,uuid,text,boolean)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
 }
 await expect(asActor(db,{id:user},tx=>tx.query('select * from private.invitation_email_attempts'))).rejects.toMatchObject({code:'42501'});
 await scenario(async tx=>{await tx.exec('set local role service_role');expect((await claim(tx)).status).toBe('CLAIMED');});
});
it('leases delivery once, retries the same payload and records provider acceptance',()=>scenario(async tx=>{
 const first=await claim(tx);expect(first.status).toBe('CLAIMED');expect((await claim(tx)).status).toBe('BUSY');
 expect(await finish(tx,first,null)).toBe(true);
 const retry=await claim(tx,false,{...payload,subject:'Changed configuration'});expect(retry.id).toBe(first.id);expect(retry.payload).toEqual(payload);
 expect(await finish(tx,first,'stale-worker')).toBe(false);
 expect(await finish(tx,retry,'provider-id')).toBe(true);expect((await claim(tx)).status).toBe('SENT');
 expect((await tx.query<{delivery_status:string}>('select delivery_status from public.invitations where id=$1',[inv])).rows[0].delivery_status).toBe('SENT');
}));
it('blocks retry after an uncertain Gmail result',()=>scenario(async tx=>{
 const first=await claim(tx);await finish(tx,first,null,true);
 expect((await claim(tx)).status).toBe('UNKNOWN');expect((await claim(tx,true)).status).toBe('UNKNOWN');
 expect((await tx.query<{delivery_status:string}>('select delivery_status from public.invitations where id=$1',[inv])).rows[0].delivery_status).toBe('UNKNOWN');
}));
it('does not send a revoked or expired invitation',async()=>{
 for(const update of ["status='REVOKED'","status='ACCEPTED'","expires_at=now()-interval '1 minute'"]){
  await scenario(async tx=>{await tx.exec('update public.invitations set '+update);await expect(claim(tx)).rejects.toMatchObject({code:'23514'});});
 }
});
it('rejects a different organization',()=>scenario(async tx=>{
 await expect(tx.query('select public.claim_invitation_email($1,$2,$3,false)',[uuid(999),inv,payload])).rejects.toMatchObject({code:'42501'});
}));
it('marks an abandoned lease uncertain instead of sending a duplicate',()=>scenario(async tx=>{
 const first=await claim(tx);await tx.exec("update private.invitation_email_attempts set lease_until=now()-interval '1 minute'");
 expect((await claim(tx)).status).toBe('UNKNOWN');expect((await claim(tx,true)).status).toBe('UNKNOWN');
 expect(await finish(tx,first,'late-provider-response')).toBe(true);expect((await claim(tx)).status).toBe('SENT');
}));
it('limits explicit resends for an already sent invitation',()=>scenario(async tx=>{
 const first=await claim(tx);await finish(tx,first,'provider-id');
 await expect(claim(tx,true)).rejects.toMatchObject({message:'email_resend_cooldown'});
}));
it('rejects a payload addressed to a different recipient',()=>scenario(async tx=>{
 await expect(claim(tx,false,{...payload,to:['someone-else@example.com']})).rejects.toMatchObject({code:'23514'});
}));
it('allows an explicit resend after its cooldown with a new attempt key',()=>scenario(async tx=>{
 const first=await claim(tx);await finish(tx,first,'provider-id');
 await tx.exec("update private.invitation_email_attempts set finished_at=now()-interval '2 minutes'");
 const second=await claim(tx,true);expect(second.status).toBe('CLAIMED');expect(second.id).not.toBe(first.id);
}));
