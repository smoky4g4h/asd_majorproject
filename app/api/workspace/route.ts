import {z} from 'zod';
import {requireActor} from '../../../lib/auth/session';
import {loadWorkspace} from '../../../lib/workspace/snapshot';
import {body,meetingInput,taskInput,documentInput,uuid} from '../../../lib/api/validation';
import {ApiError,databaseError,failure,ok} from '../../../lib/api/errors';
const action=z.discriminatedUnion('type',[
 z.object({type:z.literal('meeting'),meeting:meetingInput}).strict(),
 z.object({type:z.literal('task'),task:taskInput}).strict(),
 z.object({type:z.literal('document'),document:documentInput}).strict(),
 z.object({type:z.literal('delete-document'),id:uuid}).strict(),
 z.object({type:z.literal('rsvp'),id:uuid,value:z.enum(['ACCEPTED','DECLINED'])}).strict(),
 z.object({type:z.literal('read'),id:z.union([uuid,z.literal('all')])}).strict(),
 z.object({type:z.literal('note'),key:z.string().min(1).max(240),value:z.string().max(100000)}).strict(),
]);
export async function GET(){try{const {db,actor}=await requireActor();return ok(await loadWorkspace(db,actor))}catch(error){return failure(error)}}
export async function POST(request:Request){try{const input=await body(request,action);const {db,actor}=await requireActor();if(input.type==='meeting'&&input.meeting.state&&input.meeting.state!=='SCHEDULED')throw new ApiError(422,'LIFECYCLE_ACTION','Use the meeting lifecycle action to change meeting status.');databaseError((await db.rpc('consume_rate_limit',{p_key:'workspace-write'})).error);const saved=await db.rpc('workspace_mutate',{p_org:actor.organizationId,p_action:input});databaseError(saved.error);return ok({id:saved.data})}catch(error){return failure(error)}}
