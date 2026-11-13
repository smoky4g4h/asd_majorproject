import {beforeAll,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createPolicyDatabase,asActor,uuid} from './helpers/db';
let db:PGlite;
const member={id:uuid(910)},org=uuid(911),pending={id:uuid(912)};
beforeAll(async()=>{
 ({db}=await createPolicyDatabase());
 for(const a of [member,pending]){
  await db.query('insert into auth.users(id,email) values($1,$2)',[a.id,`fixture-${a.id.slice(-2)}@securemeet.example`]);
  await db.query("insert into auth.identities(user_id,provider) values($1,'google')",[a.id]);
 }
 await db.query("insert into public.organizations(id,name) values($1,'Google policy fixture')",[org]);
 await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'MEMBER')",[org,member.id]);
 await db.query("insert into public.tasks(organization_id,creator_id,title) values($1,$2,'Private task')",[org,member.id]);
 await db.query("insert into public.invitations(organization_id,email,role,inviter_id,auth_user_id) values($1,$2,'MEMBER',$3,$4)",[org,'fixture-12@securemeet.example',member.id,pending.id]);
},30000);
afterAll(()=>db?.close());
it('loads the deployed grant hardening migration too',async()=>{
 expect((await db.query<{allowed:boolean}>("select has_function_privilege('anon','public.accept_invitation()','EXECUTE') allowed")).rows[0].allowed).toBe(false);
});
it.each(['password','invite','otp','recovery'])('denies private reads for %s sessions even with a Google identity',async method=>{
 const result=await asActor(db,{...member,methods:[method]},tx=>tx.query('select id from public.tasks'));expect(result.rows).toHaveLength(0);
});
it('preserves Google OAuth member reads',async()=>{expect((await asActor(db,member,tx=>tx.query('select id from public.tasks'))).rows).toHaveLength(1)});
it('denies OAuth when the Google identity is absent',async()=>{
 await db.query("delete from auth.identities where user_id=$1",[member.id]);
 try{expect((await asActor(db,member,tx=>tx.query('select id from public.tasks'))).rows).toHaveLength(0)}finally{await db.query("insert into auth.identities values($1,'google')",[member.id])}
});
it('rejects invitation acceptance through a password session',async()=>{
 await expect(asActor(db,{...pending,methods:['password']},tx=>tx.query('select public.accept_invitation()'))).rejects.toMatchObject({code:'42501'});
});
it('allows the approved Google recipient to accept',async()=>{
 expect((await asActor(db,pending,tx=>tx.query('select public.accept_invitation() org'))).rows).toEqual([{org}]);
});
it('blocks profile mutation through an old password session',async()=>{
 await expect(asActor(db,{...member,methods:['password']},tx=>tx.query("select public.update_profile('Forged')"))).rejects.toMatchObject({code:'42501'});
});
it.each(['revoked','expired','disabled'] as const)('rejects a %s recipient or invitation',async scenario=>{
 if(scenario==='revoked')await db.query("update public.invitations set status='REVOKED' where auth_user_id=$1",[pending.id]);
 if(scenario==='expired')await db.query("update public.invitations set expires_at=now()-interval '1 minute' where auth_user_id=$1",[pending.id]);
 if(scenario==='disabled')await db.query("update public.profiles set status='DISABLED' where id=$1",[pending.id]);
 try{await expect(asActor(db,pending,tx=>tx.query('select public.accept_invitation()'))).rejects.toMatchObject({code:'42501'})}
 finally{await db.query("update public.profiles set status='ACTIVE' where id=$1",[pending.id]);await db.query("update public.invitations set status='PENDING',expires_at=now()+interval '1 day' where auth_user_id=$1",[pending.id])}
});
it('rejects a mismatched Google email',async()=>{await expect(asActor(db,{...pending,email:'different@securemeet.example'},tx=>tx.query('select public.accept_invitation()'))).rejects.toMatchObject({code:'42501'})});
