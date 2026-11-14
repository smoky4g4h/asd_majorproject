import 'server-only';
import {WebhookReceiver} from 'livekit-server-sdk';
import {adminClient} from '../supabase/admin';
import {mediaConfig} from './provider';
import {ApiError,databaseError,failure,ok} from '../api/errors';
import {uuid} from '../api/validation';
export async function livekitWebhook(request:Request){try{
 if(!request.headers.get('content-type')?.startsWith('application/webhook+json'))throw new ApiError(415,'CONTENT_TYPE','Webhook content type required.');
 const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
 if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw new ApiError(413,'TOO_LARGE','Webhook too large.')}chunks.push(value)}
 const raw=Buffer.concat(chunks).toString('utf8'),config=mediaConfig();let event;
 try{event=await new WebhookReceiver(config.key,config.secret).receive(raw,request.headers.get('authorization')||'')}catch{throw new ApiError(401,'SIGNATURE','Invalid webhook signature.')}
 if(!event.id||!event.room?.name||!event.room.sid||!['room_started','room_finished','participant_joined','participant_left'].includes(event.event))return ok({ignored:true});
 const at=Number(event.createdAt);if(!Number.isFinite(at)||at<=0||at>Date.now()/1000+300)throw new ApiError(422,'EVENT_TIME','Invalid event time.');
 const identity=event.participant?.identity;if(identity&&!uuid.safeParse(identity).success)return ok({ignored:true});
 const db=adminClient();databaseError((await db.rpc('record_livekit_event',{p_id:event.id,p_event:event.event,p_room:event.room.name,p_sid:event.room.sid,p_identity:identity||null,p_participant_sid:event.participant?.sid||null,p_at:new Date(at*1000).toISOString()})).error);
 return ok({received:true});
}catch(error){return failure(error)}}
