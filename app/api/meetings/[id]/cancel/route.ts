import {requireActor} from '../../../../../lib/auth/session';
import {body,uuid} from '../../../../../lib/api/validation';
import {ApiError,databaseError,failure,ok} from '../../../../../lib/api/errors';
import {endRoom} from '../../../../../lib/meeting-media/provider';
import {z} from 'zod';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{
 const {id}=await context.params;if(!uuid.safeParse(id).success)throw new ApiError(422,'VALIDATION','Invalid meeting identifier.');
 await body(request,z.object({}).strict());
 const {db,actor}=await requireActor();
 if(!['PLATFORM_ADMIN','ORG_ADMIN'].includes(actor.role)||actor.aal!=='aal2')throw new ApiError(403,'FORBIDDEN','Only a verified administrator can cancel meetings.');
 databaseError((await db.rpc('consume_rate_limit',{p_key:'meeting-cancel'})).error);
 const result=await db.rpc('admin_cancel_meeting',{p_org:actor.organizationId,p_id:id});databaseError(result.error);
 const data=result.data;
 try{await endRoom(data.roomName,data.memberIds);if(data.operationId)databaseError((await db.rpc('complete_media_operation',{p_id:data.operationId})).error);}
 catch{throw new ApiError(503,'MEDIA_PENDING','Meeting cancelled and new joins blocked. Room cleanup is pending; retry Cancel meeting to disconnect remaining participants.');}
 return ok({id,status:'CONFIRMED'});
 }catch(error){return failure(error)}}
