import 'server-only';
import {z} from 'zod';
import {AccessToken} from 'livekit-server-sdk';
import {requireActor} from '../auth/session';
import {body,uuid} from '../api/validation';
import {ApiError,databaseError,failure,ok} from '../api/errors';
import {mediaConfig,removeFromRoom,endRoom,muteTrack} from './provider';
type Context={params:Promise<{id:string;action:string[]}>};
const empty=z.object({}).strict();
const accessSchema=z.object({roomName:z.string().min(1),identity:uuid,meetingRole:z.enum(['HOST','COHOST','ATTENDEE']),version:z.number()});
function meetingId(id:string){if(!uuid.safeParse(id).success)throw new ApiError(422,'VALIDATION','Invalid meeting identifier.');return id}
function parseAction(parts:string[]){
 const action=parts.join('/');
 if(['start','admission-request','room-token','end','cancel','remove-participant','mute-participant'].includes(action))return {action,requestId:undefined};
 if(parts.length===3&&parts[0]==='admissions'&&['approve','reject'].includes(parts[2])&&uuid.safeParse(parts[1]).success)return {action:parts[2],requestId:parts[1]};
 throw new ApiError(404,'NOT_FOUND','Unknown meeting action.');
}
export async function meetingPOST(request:Request,context:Context){try{
 const params=await context.params,id=meetingId(params.id),{action,requestId}=parseAction(params.action);
 const schema=action==='remove-participant'?z.object({userId:uuid}).strict():action==='mute-participant'?z.object({userId:uuid,trackSid:z.string().min(1).max(200)}).strict():empty;
 const input=await body(request,schema) as {userId?:string;trackSid?:string};
 const {db,actor,user}=await requireActor();
 databaseError((await db.rpc('consume_rate_limit',{p_key:'meeting-'+action})).error);
 const scope=await db.from('meetings').select('id').eq('id',id).eq('organization_id',actor.organizationId).maybeSingle();databaseError(scope.error);if(!scope.data)throw new ApiError(403,'FORBIDDEN','Meeting unavailable in this organization.');
 // RPC independently derives membership/host/admission authority from the caller JWT.
 const invoke=async(name:string,data:Record<string,unknown>={})=>{const r=await db.rpc('meeting_action',{p_id:id,p_action:name,p_data:data});databaseError(r.error);return r.data};
 if(action==='room-token'){
  const permission=accessSchema.parse(await invoke('room-access'));
  if(permission.identity!==actor.userId)throw new ApiError(403,'FORBIDDEN','Room access is unavailable.');
  const config=mediaConfig();
  const token=new AccessToken(config.key,config.secret,{identity:actor.userId,name:typeof user?.user_metadata?.full_name==='string'?user.user_metadata.full_name.slice(0,160):'Workspace member',ttl:300});
  token.addGrant({roomJoin:true,room:permission.roomName,canSubscribe:true,canPublish:actor.role!=='RESTRICTED_MEMBER',canPublishData:false});
  const signed=await token.toJwt();
  const current=accessSchema.parse(await invoke('room-access'));
  if(current.identity!==actor.userId||current.version!==permission.version||current.roomName!==permission.roomName||current.meetingRole!==permission.meetingRole)throw new ApiError(409,'ROOM_CHANGED','Meeting access changed. Retry joining.');
  return ok({token:signed,serverUrl:config.url});
 }
 if(action==='start'){
  try{await invoke('start');return ok({id,status:'CONFIRMED'})}
  catch(error){
   // Rejoining a live room is not a second state transition. The RPC still checks live window/admission.
   if(!(error instanceof ApiError)||error.status!==422)throw error;
   const current=accessSchema.parse(await invoke('room-access'));
   if(current.identity!==actor.userId||!['HOST','COHOST'].includes(current.meetingRole))throw error;
   return ok({id,status:'CONFIRMED'});
  }
 }
 const data=await invoke(action,requestId?{requestId}:input);
 if(['remove-participant','mute-participant','end','cancel'].includes(action)){
  // Persisted denial/end precedes external side effects. Failures leave the SQL operation pending.
  try{
   if(action==='remove-participant')await removeFromRoom(data.roomName,input.userId!);
   else if(action==='mute-participant')await muteTrack(data.roomName,input.userId!,input.trackSid!);
   else {
    const members=await db.from('meeting_members').select('user_id').eq('meeting_id',id).eq('organization_id',actor.organizationId);databaseError(members.error);
    await endRoom(data.roomName,(members.data||[]).map(member=>member.user_id));
   }
   databaseError((await db.rpc('complete_media_operation',{p_id:data.operationId})).error);
  }catch{throw new ApiError(503,'MEDIA_PENDING','The meeting change was saved, but the media operation is not confirmed. Retry the action.');}
 }
 return ok({id,status:action==='admission-request'?'PENDING':'CONFIRMED'});
}catch(error){return failure(error)}}
export async function meetingGET(_request:Request,context:Context){try{
 const params=await context.params,id=meetingId(params.id);
 if(!['admission-requests','context'].includes(params.action.join('/')))throw new ApiError(404,'NOT_FOUND','Unknown meeting resource.');
 const {db,actor}=await requireActor();
 const meeting=await db.from('meetings').select('id').eq('id',id).eq('organization_id',actor.organizationId).maybeSingle();databaseError(meeting.error);
 if(!meeting.data)throw new ApiError(404,'NOT_FOUND','Meeting unavailable.');
 const member=await db.from('meeting_members').select('meeting_role,removed_at').eq('meeting_id',id).eq('organization_id',actor.organizationId).eq('user_id',actor.userId).maybeSingle();databaseError(member.error);
 if(!member.data||member.data.removed_at)throw new ApiError(403,'FORBIDDEN','Meeting access unavailable.');
 const host=['HOST','COHOST'].includes(member.data.meeting_role);
 if(host&&actor.aal!=='aal2')throw new ApiError(403,'MFA_REQUIRED','Verify your authenticator before managing admission.');
 if(params.action.join('/')==='context')return ok({meetingRole:member.data.meeting_role});
 let query=db.from('admission_requests').select('id,user_id,status').eq('meeting_id',id).order('created_at').limit(200);
 if(!host)query=query.eq('user_id',actor.userId);
 const rows=await query;databaseError(rows.error);return ok(rows.data||[]);
}catch(error){return failure(error)}}
