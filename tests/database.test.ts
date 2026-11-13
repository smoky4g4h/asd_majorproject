import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite,Transaction} from '@electric-sql/pglite';
import {asActor,createPolicyDatabase,setActor,uuid,type TestActor} from './helpers/db';

const orgA=uuid(100),orgB=uuid(101);
const admin:TestActor={id:uuid(1),aal:'aal2'},member:TestActor={id:uuid(2)},disabled:TestActor={id:uuid(3)},foreign:TestActor={id:uuid(4)},uninvited:TestActor={id:uuid(5)},outsider:TestActor={id:uuid(6)},pending:TestActor={id:uuid(7)};
const disabledProfile:TestActor={id:uuid(8)},platformAdmin:TestActor={id:uuid(9),aal:'aal2'};
const meeting=uuid(200),otherMeeting=uuid(201),task=uuid(300),privateTask=uuid(301),otherTask=uuid(302),archivedTask=uuid(303);
const privateDoc=uuid(400),sharedDoc=uuid(401),trashedDoc=uuid(402),otherDoc=uuid(403),pendingDoc=uuid(404);
const dm=uuid(500),meetingThread=uuid(501),otherThread=uuid(502);
let db:PGlite;
async function ids(tx:Transaction,table:'tasks'|'documents'|'meetings'|'messages'){
 return (await tx.query<{id:string}>(`select id from public.${table} order by id`)).rows.map(row=>row.id);
}

beforeAll(async()=>{
 ({db}=await createPolicyDatabase());
 // Owner access is used only to construct controlled fixtures. Every assertion uses SET LOCAL ROLE.
 for(const actor of [admin,member,disabled,foreign,uninvited,outsider,pending,disabledProfile,platformAdmin]){
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[actor.id,`fixture-${actor.id.slice(-2)}@securemeet.example`,JSON.stringify({full_name:'Fictional test user'})]);
 }
 await db.exec("insert into auth.identities(user_id,provider) select id,'google' from auth.users");
 await db.query('insert into public.organizations(id,name) values($1,$2),($3,$4)',[orgA,'Fictional institute A',orgB,'Fictional institute B']);
 for(const [actor,org,role,state] of [[admin,orgA,'ORG_ADMIN','ACTIVE'],[member,orgA,'MEMBER','ACTIVE'],[disabled,orgA,'MEMBER','DISABLED'],[foreign,orgB,'MEMBER','ACTIVE'],[outsider,orgA,'MEMBER','ACTIVE'],[pending,orgA,'RESTRICTED_MEMBER','ACTIVE'],[disabledProfile,orgA,'MEMBER','ACTIVE'],[platformAdmin,orgA,'PLATFORM_ADMIN','ACTIVE']] as const){
  await db.query('insert into public.organization_members(organization_id,user_id,role,state) values($1,$2,$3,$4)',[org,actor.id,role,state]);
 }
 await db.query("update public.profiles set status='DISABLED' where id=$1",[disabledProfile.id]);
 await db.query("insert into public.meetings(id,organization_id,organizer_id,title,starts_at,ends_at,status) values($1,$2,$3,'First meeting',now()-interval '5 minutes',now()+interval '55 minutes','LIVE'),($4,$5,$6,'Foreign meeting',now(),now()+interval '1 hour','SCHEDULED')",[meeting,orgA,admin.id,otherMeeting,orgB,foreign.id]);
 for(const [mid,org,actor,role,admitted] of [[meeting,orgA,admin,'HOST',true],[meeting,orgA,member,'ATTENDEE',true],[meeting,orgA,pending,'ATTENDEE',false],[meeting,orgA,disabled,'ATTENDEE',true],[otherMeeting,orgB,foreign,'HOST',true]] as const){
  await db.query("insert into public.meeting_members(meeting_id,organization_id,user_id,meeting_role,admitted_at) values($1,$2,$3,$4,case when $5 then now() else null end)",[mid,org,actor.id,role,admitted]);
 }
 for(const [tid,org,creator,archived] of [[task,orgA,admin.id,false],[privateTask,orgA,admin.id,false],[otherTask,orgB,foreign.id,false],[archivedTask,orgA,admin.id,true]] as const){
  await db.query("insert into public.tasks(id,organization_id,creator_id,title,archived_at) values($1,$2,$3,'Task fixture',case when $4 then now() else null end)",[tid,org,creator,archived]);
 }
 for(const tid of [task,archivedTask])await db.query('insert into public.task_assignees(task_id,organization_id,user_id) values($1,$2,$3)',[tid,orgA,member.id]);
 for(const [did,org,owner,deleted,upload] of [[privateDoc,orgA,admin.id,false,'READY'],[sharedDoc,orgA,admin.id,false,'READY'],[trashedDoc,orgA,admin.id,true,'READY'],[otherDoc,orgB,foreign.id,false,'READY'],[pendingDoc,orgA,admin.id,false,'PENDING']] as const){
  await db.query("insert into public.documents(id,organization_id,owner_id,meeting_id,name,deleted_at,upload_state) values($1,$2,$3,$4,'Private document',case when $5 then now() else null end,$6)",[did,org,owner,org===orgA?meeting:otherMeeting,deleted,upload]);
 }
 for(const did of [sharedDoc,trashedDoc,pendingDoc])await db.query("insert into public.document_access(document_id,organization_id,user_id,permission) values($1,$2,$3,'reader')",[did,orgA,member.id]);
 for(const [tid,org,creator,kind,mid] of [[dm,orgA,admin.id,'dm',null],[meetingThread,orgA,admin.id,'meeting',meeting],[otherThread,orgB,foreign.id,'dm',null]] as const){
  await db.query('insert into public.message_threads(id,organization_id,creator_id,kind,meeting_id) values($1,$2,$3,$4,$5)',[tid,org,creator,kind,mid]);
 }
 for(const actor of [admin,member])await db.query('insert into public.thread_members(thread_id,organization_id,user_id) values($1,$2,$3)',[dm,orgA,actor.id]);
 await db.query('insert into public.thread_members(thread_id,organization_id,user_id) values($1,$2,$3)',[otherThread,orgB,foreign.id]);
 for(const [id,thread,author] of [[uuid(600),dm,admin.id],[uuid(601),meetingThread,admin.id],[uuid(602),otherThread,foreign.id]])await db.query("insert into public.messages(id,thread_id,author_id,body) values($1,$2,$3,'Fictional message')",[id,thread,author]);
 await db.query("insert into public.invitations(id,organization_id,email,role,inviter_id,auth_user_id) values($1,$2,$3,'ORGANIZER',$4,$5)",[uuid(800),orgA,'fixture-05@securemeet.example',admin.id,uninvited.id]);
},30_000);
afterAll(async()=>{await db?.close()});

describe('local PostgreSQL harness — core SQL RLS (not hosted Supabase proof)',()=>{
 it('executes policy assertions under authenticated with no RLS bypass',async()=>{
  const row=await asActor(db,member,async tx=>(await tx.query<{current_user:string;rolbypassrls:boolean}>('select current_user,rolbypassrls from pg_roles where rolname=current_user')).rows[0]);
  expect(row).toEqual({current_user:'authenticated',rolbypassrls:false});
 });
 it('shows assigned and archived tasks, excluding another member’s private task',async()=>{
  expect(await asActor(db,member,tx=>ids(tx,'tasks'))).toEqual([task,archivedTask]);
 });
 it('allows an AAL2 administrator to view scoped tasks but not another organization',async()=>{
  expect(await asActor(db,admin,tx=>ids(tx,'tasks'))).toEqual([task,privateTask,archivedTask]);
 });
 it('requires explicit file sharing even for an admitted meeting participant',async()=>{
  expect(await asActor(db,member,tx=>ids(tx,'documents'))).toEqual([sharedDoc]);
 });
 it('keeps trashed and unfinished uploads visible to their owner but not a shared reader',async()=>{
  expect(await asActor(db,admin,tx=>ids(tx,'documents'))).toEqual([privateDoc,sharedDoc,trashedDoc,pendingDoc]);
 });
 it('shows only meetings with an explicit meeting membership',async()=>{
  expect(await asActor(db,member,tx=>ids(tx,'meetings'))).toEqual([meeting]);
  expect(await asActor(db,outsider,tx=>ids(tx,'meetings'))).toEqual([]);
 });
 it('allows only thread members to read DM messages and admitted users to read meeting chat',async()=>{
  expect(await asActor(db,member,tx=>ids(tx,'messages'))).toEqual([uuid(600),uuid(601)]);
  expect(await asActor(db,pending,tx=>ids(tx,'messages'))).toEqual([]);
  expect(await asActor(db,outsider,tx=>ids(tx,'messages'))).toEqual([]);
 });
 it.each(['tasks','documents','meetings','messages'] as const)('isolates foreign organization %s',async table=>{
  const expected={tasks:[otherTask],documents:[otherDoc],meetings:[otherMeeting],messages:[uuid(602)]};
  expect(await asActor(db,foreign,tx=>ids(tx,table))).toEqual(expected[table]);
 });
 it.each([['disabled',disabled],['disabled profile',disabledProfile],['uninvited',uninvited],['privileged AAL1',{...admin,aal:'aal1'}]] as const)('denies all private resource reads to %s',async(_name,actor)=>{
  for(const table of ['tasks','documents','meetings','messages'] as const)expect(await asActor(db,actor,tx=>ids(tx,table))).toEqual([]);
 });
 it.each(['tasks','documents','meetings','messages'] as const)('denies anonymous SELECT on %s',async table=>{
  await expect(asActor(db,null,tx=>ids(tx,table))).rejects.toMatchObject({code:'42501'});
 });
 it('cannot elevate role through mutable auth metadata',async()=>{
  const actor={...member,metadata:{role:'PLATFORM_ADMIN'}};
  expect(await asActor(db,actor,tx=>ids(tx,'tasks'))).toEqual([task,archivedTask]);
 });
 it('blocks direct role escalation even for an AAL2 org admin',async()=>{
  await expect(asActor(db,admin,tx=>tx.query("update public.organization_members set role='PLATFORM_ADMIN' where user_id=$1",[member.id]))).rejects.toMatchObject({code:'42501'});
 });
 it('blocks direct writes that bypass the transactional API',async()=>{
  await expect(asActor(db,member,tx=>tx.query("insert into public.tasks(organization_id,creator_id,title) values($1,$2,'Unauthorized task')",[orgA,member.id]))).rejects.toMatchObject({code:'42501'});
 });
 it('blocks direct ACL grants and forged message authors',async()=>{
  await expect(asActor(db,member,tx=>tx.query("insert into public.document_access(document_id,organization_id,user_id,permission) values($1,$2,$3,'editor')",[privateDoc,orgA,member.id]))).rejects.toMatchObject({code:'42501'});
  await expect(asActor(db,member,tx=>tx.query("insert into public.messages(thread_id,author_id,body) values($1,$2,'Forged')",[dm,admin.id]))).rejects.toMatchObject({code:'42501'});
 });
});

describe('local PostgreSQL harness — transactional authorization and state',()=>{
 const mutate=(tx:Transaction,action:unknown,org=orgA)=>tx.query<{id:string}>('select public.workspace_mutate($1,$2::jsonb) as id',[org,JSON.stringify(action)]);
 const action=(tx:Transaction,verb:string,data:unknown={},mid=meeting)=>tx.query<{result:Record<string,unknown>}>('select public.meeting_action($1,$2,$3::jsonb) as result',[mid,verb,JSON.stringify(data)]);
 const newTask={type:'task',task:{id:uuid(700),title:'Assigned through SQL',assignee:member.id,collaboratorIds:[],checklist:[{text:'Review evidence',done:false}]}};

 it('creates assignment, checklist and recipient notification in one transaction',async()=>{
  await asActor(db,admin,async tx=>{
   expect((await mutate(tx,newTask)).rows[0].id).toBe(uuid(700));
   await setActor(tx,member);
   const taskRow=(await tx.query<{creator_id:string}>('select creator_id from public.tasks where id=$1',[uuid(700)])).rows[0];
   expect(taskRow.creator_id).toBe(admin.id);
   expect((await tx.query('select body,done from public.task_checklist_items where task_id=$1',[uuid(700)])).rows).toEqual([{body:'Review evidence',done:false}]);
   expect((await tx.query('select user_id from public.notifications where target=$1',[`/tasks?task=${uuid(700)}`])).rows).toEqual([{user_id:member.id}]);
  });
 });
 it('lets an assigned member archive a task without granting an outsider access',async()=>{
  await asActor(db,member,async tx=>{
   await mutate(tx,{type:'task',task:{id:task,title:'Archived assignment',assignee:member.id,archived:true}});
   expect((await tx.query<{archived:boolean}>('select archived_at is not null as archived from public.tasks where id=$1',[task])).rows[0].archived).toBe(true);
   await setActor(tx,outsider);expect(await ids(tx,'tasks')).toEqual([]);
  });
 });
 it.each([['foreign',foreign],['disabled',disabled],['disabled profile',disabledProfile]])('rejects assigning a task to a %s identity',async(_name,actor)=>{
  await expect(asActor(db,admin,tx=>mutate(tx,{...newTask,task:{...newTask.task,assignee:actor.id}}))).rejects.toMatchObject({code:'42501'});
 });
 it('denies member reassignment to another same-org person',async()=>{
  await expect(asActor(db,member,tx=>mutate(tx,{type:'task',task:{id:task,title:'Attempted reassignment',assignee:outsider.id}}))).rejects.toMatchObject({code:'42501'});
 });
 it('rejects a foreign-org resource ID without changing its scope',async()=>{
  await expect(asActor(db,admin,tx=>mutate(tx,{type:'task',task:{id:otherTask,title:'Hijack',assignee:member.id}}))).rejects.toMatchObject({code:'42501'});
 });
 it.each([['anonymous',null],['uninvited',uninvited],['disabled',disabled],['privileged AAL1',{...admin,aal:'aal1'}]] as const)('denies transactional mutations for %s',async(_name,actor)=>{
  await expect(asActor(db,actor,tx=>mutate(tx,newTask))).rejects.toMatchObject({code:'42501'});
 });
 it('denies member edits to unassigned private tasks',async()=>{
  await expect(asActor(db,member,tx=>mutate(tx,{type:'task',task:{id:privateTask,title:'Hijacked',assignee:member.id}}))).rejects.toMatchObject({code:'42501'});
 });
 it('does not let a document reader rename the shared file',async()=>{
  await expect(asActor(db,member,tx=>mutate(tx,{type:'document',document:{id:sharedDoc,name:'Unauthorized rename',content:'Changed'}}))).rejects.toMatchObject({code:'42501'});
 });
 it('does not share a document across organizations',async()=>{
  await expect(asActor(db,admin,tx=>mutate(tx,{type:'document',document:{id:sharedDoc,name:'Private',selected:[foreign.id]}}))).rejects.toMatchObject({code:'42501'});
 });
 it('removes access immediately when the owner trashes a shared file',async()=>{
  await asActor(db,admin,async tx=>{
   await mutate(tx,{type:'delete-document',id:sharedDoc});
   expect((await ids(tx,'documents')).includes(sharedDoc)).toBe(true);
   await setActor(tx,member);expect(await ids(tx,'documents')).toEqual([]);
  });
 });
 it('revokes document sharing without depending on UI state',async()=>{
  await asActor(db,admin,async tx=>{
   await mutate(tx,{type:'document',document:{id:sharedDoc,name:'Still private',selected:[]}});
   await setActor(tx,member);expect(await ids(tx,'documents')).toEqual([]);
  });
 });
 it('ending twice returns the same media operation without duplicate notifications',async()=>{
  await asActor(db,admin,async tx=>{
   const first=(await action(tx,'end')).rows[0].result;
   const before=(await tx.query<{n:number}>('select count(*)::int as n from public.notifications')).rows[0].n;
   const second=(await action(tx,'end')).rows[0].result;
   expect(second.operationId).toBe(first.operationId);
   expect((await tx.query<{n:number}>('select count(*)::int as n from public.notifications')).rows[0].n).toBe(before);
  });
 });
 it('cannot turn an ended meeting into cancelled',async()=>{
  await expect(asActor(db,admin,async tx=>{await action(tx,'end');await action(tx,'cancel')})).rejects.toMatchObject({code:'23514'});
 });
 it('cannot create mute operations after a meeting ends',async()=>{
  await expect(asActor(db,admin,async tx=>{await action(tx,'end');await action(tx,'mute-participant',{userId:member.id,trackSid:'mic'})})).rejects.toMatchObject({code:'23514'});
 });
 it('removing twice returns the same queued media operation',async()=>{
  await asActor(db,admin,async tx=>{
   const first=(await action(tx,'remove-participant',{userId:member.id})).rows[0].result;
   const second=(await action(tx,'remove-participant',{userId:member.id})).rows[0].result;
   expect(second.operationId).toBe(first.operationId);
  });
 });
 it('permits current room access only after admission',async()=>{
  const data=await asActor(db,member,tx=>action(tx,'room-access'));
  expect(data.rows[0].result.identity).toBe(member.id);
  expect(data.rows[0].result.meetingRole).toBe('ATTENDEE');
  await expect(asActor(db,pending,tx=>action(tx,'room-access'))).rejects.toMatchObject({code:'42501'});
 });
 it('denies attendee host actions and a forwarded foreign room ID',async()=>{
  await expect(asActor(db,member,tx=>action(tx,'end'))).rejects.toMatchObject({code:'42501'});
  await expect(asActor(db,foreign,tx=>action(tx,'room-access'))).rejects.toMatchObject({code:'42501'});
 });
 it('lets an eligible member request admission and its host approve it',async()=>{
  await asActor(db,pending,async tx=>{
   await action(tx,'admission-request');
   const request=(await tx.query<{id:string}>('select id from public.admission_requests where meeting_id=$1 and user_id=$2',[meeting,pending.id])).rows[0];
   await setActor(tx,admin);await action(tx,'approve',{requestId:request.id});
   await setActor(tx,pending);expect((await action(tx,'room-access')).rows[0].result.identity).toBe(pending.id);
   expect(await ids(tx,'messages')).toEqual([uuid(601)]);
  });
 });
 it('removal revokes meeting visibility, chat and future room-access checks',async()=>{
  await asActor(db,admin,async tx=>{
   await action(tx,'remove-participant',{userId:member.id});
   await setActor(tx,member);
   expect(await ids(tx,'meetings')).toEqual([]);
   expect(await ids(tx,'messages')).toEqual([uuid(600)]);
   expect((await tx.query<{allowed:boolean}>('select private.can_meeting($1) as allowed',[meeting])).rows[0].allowed).toBe(false);
  });
  await expect(asActor(db,admin,async tx=>{await action(tx,'remove-participant',{userId:member.id});await setActor(tx,member);await action(tx,'room-access')})).rejects.toMatchObject({code:'42501'});
 });
 it('ending a room prevents subsequent participant room access',async()=>{
  await expect(asActor(db,admin,async tx=>{await action(tx,'end');await setActor(tx,member);await action(tx,'room-access')})).rejects.toMatchObject({code:'42501'});
 });
 it('deactivation revokes an existing actor’s readable resources',async()=>{
  await asActor(db,admin,async tx=>{
   await tx.query("select public.manage_member($1,$2,'MEMBER',false)",[orgA,member.id]);
   await setActor(tx,member);
   for(const table of ['tasks','documents','meetings','messages'] as const)expect(await ids(tx,table)).toEqual([]);
  });
 });
 it('does not let an org admin promote another user to platform admin',async()=>{
  await expect(asActor(db,admin,tx=>tx.query("select public.manage_member($1,$2,'PLATFORM_ADMIN',true)",[orgA,member.id]))).rejects.toMatchObject({code:'42501'});
 });
 it('protects the last active platform administrator',async()=>{
  await expect(asActor(db,platformAdmin,tx=>tx.query("select public.manage_member($1,$2,'MEMBER',true)",[orgA,platformAdmin.id]))).rejects.toMatchObject({code:'23514',message:'Last platform admin'});
 });
 it('requires AAL2 to accept an organizer invitation',async()=>{
  await expect(asActor(db,uninvited,tx=>tx.query('select public.accept_invitation()'))).rejects.toMatchObject({code:'42501',message:'MFA_REQUIRED'});
 });
 it('activates only the approved invitation identity and role',async()=>{
  await asActor(db,{...uninvited,aal:'aal2'},async tx=>{
   expect((await tx.query<{org:string}>('select public.accept_invitation() as org')).rows[0].org).toBe(orgA);
   expect((await tx.query('select role,state from public.organization_members where organization_id=$1 and user_id=$2',[orgA,uninvited.id])).rows).toEqual([{role:'ORGANIZER',state:'ACTIVE'}]);
  });
  await expect(asActor(db,{...uninvited,aal:'aal2',email:'wrong@securemeet.example'},tx=>tx.query('select public.accept_invitation()'))).rejects.toMatchObject({code:'42501'});
 });
 it('refuses replay after invitation acceptance',async()=>{
  await expect(asActor(db,{...uninvited,aal:'aal2'},async tx=>{await tx.query('select public.accept_invitation()');await tx.query('select public.accept_invitation()')})).rejects.toMatchObject({code:'42501'});
 });
});
it('does not report revocation success for an already accepted invitation',async()=>{
 await db.query("update public.invitations set status='ACCEPTED' where id=$1",[uuid(800)]);
 try{await expect(asActor(db,admin,tx=>tx.query('select public.revoke_invitation($1)',[uuid(800)]))).rejects.toMatchObject({code:'23514'})}
 finally{await db.query("update public.invitations set status='PENDING' where id=$1",[uuid(800)])}
});

describe('durable media recovery',()=>{
 it('denies ordinary members worker access',async()=>{
  await expect(asActor(db,member,tx=>tx.query('select * from public.claim_media_operations()'))).rejects.toMatchObject({code:'42501'});
 });
 it('claims each pending operation once and fences stale acknowledgements',async()=>{
  await db.transaction(async tx=>{
   await tx.query("insert into private.media_operations(meeting_id,operation) values($1,'END')",[meeting]);
   await tx.exec('set local role service_role');
   const jobs=(await tx.query<{id:string;lease_token:string}>('select * from public.claim_media_operations()')).rows;
   expect(jobs).toHaveLength(1);
   expect((await tx.query('select * from public.claim_media_operations()')).rows).toHaveLength(0);
   await tx.query('select public.finish_media_operation($1,$2,true)',[jobs[0].id,uuid(999)]);
   await tx.exec('reset role');
   expect((await tx.query<{status:string}>('select status from private.media_operations where id=$1',[jobs[0].id])).rows[0].status).toBe('PENDING');
   await tx.exec('set local role service_role');
   await tx.query('select public.finish_media_operation($1,$2,true)',[jobs[0].id,jobs[0].lease_token]);
   await tx.exec('reset role');
   expect((await tx.query<{status:string}>('select status from private.media_operations where id=$1',[jobs[0].id])).rows[0].status).toBe('DONE');
   await tx.rollback();
  });
 });
 it('reclaims expired leases and delays failed jobs',async()=>{
  await db.transaction(async tx=>{
   await tx.query("insert into private.media_operations(meeting_id,operation,lease_until,lease_token) values($1,'END',now()-interval '1 minute',$2)",[meeting,uuid(998)]);
   await tx.exec('set local role service_role');
   const job=(await tx.query<{id:string;lease_token:string}>('select * from public.claim_media_operations()')).rows[0];
   expect(job.lease_token).not.toBe(uuid(998));
   await tx.query('select public.finish_media_operation($1,$2,false)',[job.id,job.lease_token]);
   expect((await tx.query('select * from public.claim_media_operations()')).rows).toHaveLength(0);
   await tx.exec('reset role');
   const row=(await tx.query<{status:string;delayed:boolean}>('select status,available_at>now() as delayed from private.media_operations where id=$1',[job.id])).rows[0];
   expect(row).toEqual({status:'PENDING',delayed:true});await tx.rollback();
  });
 });
});

describe('persistent messaging',()=>{
 it('creates one canonical conversation for either direction',async()=>{
  await asActor(db,member,async tx=>{
   const first=(await tx.query<{id:string}>('select public.open_direct_thread($1,$2) as id',[orgA,admin.id])).rows[0].id;
   await setActor(tx,admin);
   const second=(await tx.query<{id:string}>('select public.open_direct_thread($1,$2) as id',[orgA,member.id])).rows[0].id;
   expect(second).toBe(first);
  });
 });
 it('blocks cross-organization and disabled recipients',async()=>{
  for(const target of [foreign.id,disabled.id,disabledProfile.id])await expect(asActor(db,member,tx=>tx.query('select public.open_direct_thread($1,$2)',[orgA,target]))).rejects.toMatchObject({code:'42501'});
 });
 it('saves a retry exactly once and denies outsiders',async()=>{
  await asActor(db,member,async tx=>{
   const args=[dm,uuid(850),'A real message'];
   const first=(await tx.query<{result:{id:string}}>('select public.send_message($1,$2,$3) as result',args)).rows[0].result;
   const second=(await tx.query<{result:{id:string}}>('select public.send_message($1,$2,$3) as result',args)).rows[0].result;
   expect(second.id).toBe(first.id);
   await setActor(tx,outsider);
   expect((await tx.query('select * from public.messages where id=$1',[first.id])).rows).toHaveLength(0);
  });
  await expect(asActor(db,outsider,tx=>tx.query('select public.send_message($1,$2,$3)',[dm,uuid(851),'Unauthorized']))).rejects.toMatchObject({code:'42501'});
 });
 it('denies room chat after meeting end',async()=>{
  await asActor(db,admin,async tx=>{
   await tx.query("select public.meeting_action($1,'end')",[meeting]);
   await setActor(tx,member);
   expect((await tx.query('select * from public.messages where thread_id=$1',[meetingThread])).rows).toHaveLength(0);
  });
 });
});

describe('conversation pagination and read receipts',()=>{
 it('pages tied timestamps without leaking another thread',async()=>{
  await db.transaction(async tx=>{
   await tx.query("insert into public.messages(thread_id,author_id,body,created_at) select $1,$2,'Page fixture',now() from generate_series(1,60)",[dm,member.id]);
   await setActor(tx,member);
   const first=(await tx.query<{id:string}>('select * from public.list_messages($1)',[dm])).rows;
   expect(first).toHaveLength(51);
   const second=(await tx.query<{id:string}>('select * from public.list_messages($1,$2)',[dm,first[49].id])).rows;
   expect(second.some(row=>first.slice(0,50).some(previous=>previous.id===row.id))).toBe(false);
   await tx.rollback();
  });
 });
 it('read receipts never move backwards or mark another member read',async()=>{
  await db.transaction(async tx=>{
   const recent=uuid(880),old=uuid(881);
   await tx.query("insert into public.messages(id,thread_id,author_id,body,created_at) values($1,$2,$3,'Recent',now()),($4,$2,$3,'Earlier',now()-interval '1 hour')",[recent,dm,admin.id,old]);
   await setActor(tx,member);
   await tx.query('select public.read_conversation($1,$2)',[dm,recent]);
   await tx.query('select public.read_conversation($1,$2)',[dm,old]);
   const row=(await tx.query<{correct:boolean}>('select read_at=(select created_at from public.messages where id=$1) as correct from public.thread_members where thread_id=$2 and user_id=$3',[recent,dm,member.id])).rows[0];expect(row.correct).toBe(true);
   await tx.exec('reset role');
   expect((await tx.query<{read_at:null}>('select read_at from public.thread_members where thread_id=$1 and user_id=$2',[dm,admin.id])).rows[0].read_at).toBeNull();
   await tx.rollback();
  });
 });
});
