import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {ActorContext} from './contracts';
import type {State} from '../domain';
import {databaseError} from '../api/errors';
// Every query uses the verified caller's client and RLS. Explicit org filters add defense in depth.
export async function loadWorkspace(db:SupabaseClient,actor:ActorContext):Promise<State>{
 const org=actor.organizationId;
 const results=await Promise.all([
  db.rpc('workspace_directory',{p_org:org}),
  db.from('organization_members').select('organization_id,role').eq('user_id',actor.userId).eq('state','ACTIVE'),
  db.from('organizations').select('id,name,icon'),
  db.from('meetings').select('*').eq('organization_id',org).order('starts_at'),
  db.from('meeting_members').select('*').eq('organization_id',org),
  db.from('tasks').select('*').eq('organization_id',org).is('archived_at',null).order('created_at'),
  db.from('task_assignees').select('*').eq('organization_id',org),
  db.from('task_checklist_items').select('*').order('position'),
  db.from('documents').select('*').eq('organization_id',org),
  db.from('document_access').select('*').eq('organization_id',org),
  db.from('folders').select('id,name').eq('organization_id',org),
  db.from('favorites').select('document_id').eq('user_id',actor.userId),
  db.from('notifications').select('*').eq('organization_id',org).eq('user_id',actor.userId).order('created_at',{ascending:false}).limit(200),
  db.from('notes').select('title,body').eq('organization_id',org).eq('author_id',actor.userId),
 ]);
 for(const result of results)databaseError(result.error);
 const [members,memberships,organizations,meetings,participants,tasks,assignees,checklist,documents,access,folders,favorites,notifications,notes]=results.map(r=>(r.data||[]) as Record<string,any>[]);
 return {currentUserId:actor.userId,
 organizationId:org,organizations:organizations.filter(o=>memberships.some(m=>m.organization_id===o.id)).map(o=>({...o,role:memberships.find(m=>m.organization_id===o.id)?.role})) as State['organizations'],
 users:members.map(m=>({id:m.user_id,name:m.full_name,role:m.role,email:m.email||undefined,avatarUrl:m.avatar_url||undefined,mfaEnabled:m.mfa_enabled??undefined,affiliation:organizations.find(o=>o.id===org)?.name||'',active:m.state==='ACTIVE',joinedAt:m.created_at})),
 meetings:meetings.map(m=>({id:m.id,title:m.title,description:m.description,organizerId:m.organizer_id,participantIds:participants.filter(p=>p.meeting_id===m.id&&!p.removed_at).map(p=>p.user_id),startAt:m.starts_at,endAt:m.ends_at,state:m.status,agenda:Array.isArray(m.agenda)?m.agenda:[],rsvp:Object.fromEntries(participants.filter(p=>p.meeting_id===m.id).map(p=>[p.user_id,p.invitation_status]))})),
 tasks:tasks.map(t=>({id:t.id,title:t.title,description:t.description,meetingId:t.meeting_id||'',assignee:assignees.find(a=>a.task_id===t.id)?.user_id||t.creator_id,collaboratorIds:assignees.filter(a=>a.task_id===t.id).map(a=>a.user_id),done:t.status==='Done',status:t.status,priority:t.priority,due:t.due_at||'',checklist:checklist.filter(c=>c.task_id===t.id).map(c=>({id:c.id,text:c.body,done:c.done}))})),
 documents:documents.map(d=>({id:d.id,name:d.name,ownerId:d.owner_id,meetingId:d.meeting_id||'',visibility:access.some(a=>a.document_id===d.id)?'SELECTED_USERS':'PRIVATE',selected:access.filter(a=>a.document_id===d.id).map(a=>a.user_id),folder:folders.find(f=>f.id===d.folder_id)?.name||'',favorite:favorites.some(f=>f.document_id===d.id),content:d.body,size:d.size,kind:d.kind,deleted:!!d.deleted_at,createdAt:d.created_at,updatedAt:d.updated_at})),
 notifications:notifications.map(n=>({id:n.id,userId:n.user_id,text:n.body,target:n.target,read:!!n.read_at})),notes:Object.fromEntries(notes.map(n=>[n.title,n.body]))};
}
