import 'server-only';
import {z} from 'zod';
import {requireActor} from '../auth/session';
import {body,uuid} from '../api/validation';
import {ApiError,databaseError,failure,ok} from '../api/errors';
import type {SupabaseClient} from '@supabase/supabase-js';
async function threadScope(db:SupabaseClient,org:string,id:string){const row=await db.from('message_threads').select('id').eq('id',id).eq('organization_id',org).maybeSingle();databaseError(row.error);if(!row.data)throw new ApiError(403,'FORBIDDEN','This conversation is unavailable in the selected organization.')}
type Context={params:Promise<{id:string}>};
function validId(id:string){if(!uuid.safeParse(id).success)throw new ApiError(422,'VALIDATION','Invalid conversation.');return id}
export async function openChat(request:Request){try{
 const input=await body(request,z.union([z.object({recipientId:uuid}).strict(),z.object({meetingId:uuid}).strict()]));
 const {db,actor}=await requireActor();
 databaseError((await db.rpc('consume_rate_limit',{p_key:'chat-open'})).error);
 if('recipientId' in input){const result=await db.rpc('open_direct_thread',{p_org:actor.organizationId,p_recipient:input.recipientId});databaseError(result.error);return ok({id:result.data})}
 const result=await db.from('message_threads').select('id').eq('organization_id',actor.organizationId).eq('meeting_id',input.meetingId).maybeSingle();databaseError(result.error);
 if(!result.data)throw new ApiError(403,'FORBIDDEN','Join the meeting before opening its conversation.');
 return ok(result.data);
}catch(error){return failure(error)}}
export async function getMessages(request:Request,context:Context){try{
 const id=validId((await context.params).id),before=new URL(request.url).searchParams.get('before');if(before)validId(before);
 const {db,actor}=await requireActor();await threadScope(db,actor.organizationId,id);
 const result=await db.rpc('list_messages',{p_thread:id,p_before:before||null});databaseError(result.error);
 const rows=result.data||[];return ok({messages:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null});
}catch(error){return failure(error)}}
export async function postMessage(request:Request,context:Context){try{
 const id=validId((await context.params).id);
 const input=await body(request,z.object({clientMessageId:uuid,body:z.string().trim().min(1).max(10000)}).strict());
 const {db,actor}=await requireActor();await threadScope(db,actor.organizationId,id);databaseError((await db.rpc('consume_rate_limit',{p_key:'message-send'})).error);
 const result=await db.rpc('send_message',{p_thread:id,p_client:input.clientMessageId,p_body:input.body});databaseError(result.error);return ok(result.data);
}catch(error){return failure(error)}}

export async function readConversation(request:Request,context:Context){try{
 const id=validId((await context.params).id),input=await body(request,z.object({messageId:uuid}).strict());
 const {db,actor}=await requireActor();await threadScope(db,actor.organizationId,id);databaseError((await db.rpc('read_conversation',{p_thread:id,p_message:input.messageId})).error);return ok({read:true});
}catch(error){return failure(error)}}

export async function syncChat(request:Request,context:Context){try{
 const id=validId((await context.params).id),input=await body(request,z.object({loaded:z.array(uuid).max(500)}).strict());
 const {db,actor}=await requireActor();const result=await db.rpc('sync_messages',{p_org:actor.organizationId,p_thread:id,p_loaded:input.loaded});databaseError(result.error);return ok({messages:result.data||[]});
}catch(error){return failure(error)}}
export async function changeMessage(request:Request,context:Context){try{
 const id=validId((await context.params).id),input=await body(request,z.object({messageId:uuid,action:z.enum(['edit','delete']),body:z.string().trim().min(1).max(10000).optional(),revision:z.number().int().min(1)}).strict());
 const {db,actor}=await requireActor();databaseError((await db.rpc('consume_rate_limit',{p_key:'message-change'})).error);
 const result=await db.rpc('change_message',{p_org:actor.organizationId,p_thread:id,p_id:input.messageId,p_action:input.action,p_body:input.body||null,p_revision:input.revision});if(result.error?.code==='40001')throw new ApiError(409,'MESSAGE_CHANGED','This message changed. Refresh and try again.');databaseError(result.error);return ok(result.data);
}catch(error){return failure(error)}}
export async function scheduledGET(_request:Request,context:Context){try{
 const id=validId((await context.params).id),{db,actor}=await requireActor();await threadScope(db,actor.organizationId,id);
 const result=await db.from('scheduled_messages').select('id,body,send_at,status').eq('organization_id',actor.organizationId).eq('thread_id',id).eq('author_id',actor.userId).in('status',['PENDING','FAILED']).order('send_at').limit(50);databaseError(result.error);return ok({messages:result.data||[],enabled:process.env.CHAT_SCHEDULING_ENABLED==='true'});
}catch(error){return failure(error)}}
export async function scheduledPOST(request:Request,context:Context){try{
 const id=validId((await context.params).id),input=await body(request,z.union([z.object({action:z.literal('schedule'),clientMessageId:uuid,body:z.string().trim().min(1).max(10000),sendAt:z.iso.datetime()}).strict(),z.object({action:z.literal('cancel'),id:uuid}).strict()]));
 const {db,actor}=await requireActor();await threadScope(db,actor.organizationId,id);databaseError((await db.rpc('consume_rate_limit',{p_key:'message-schedule'})).error);
 if(input.action==='schedule'&&process.env.CHAT_SCHEDULING_ENABLED!=='true')throw new ApiError(503,'SCHEDULING_UNAVAILABLE','Scheduled delivery is not enabled yet. Send your message now instead.');
 if(input.action==='cancel'){const row=await db.from('scheduled_messages').select('id').eq('id',input.id).eq('thread_id',id).maybeSingle();databaseError(row.error);if(!row.data)throw new ApiError(404,'NOT_FOUND','Scheduled message unavailable.');}
 const result=input.action==='schedule'?await db.rpc('schedule_message',{p_org:actor.organizationId,p_thread:id,p_client:input.clientMessageId,p_body:input.body,p_when:input.sendAt}):await db.rpc('cancel_scheduled_message',{p_org:actor.organizationId,p_id:input.id});if(result.error?.code==='40001')throw new ApiError(409,'ALREADY_SENT','This message is no longer pending.');databaseError(result.error);return ok({id:result.data});
}catch(error){return failure(error)}}
