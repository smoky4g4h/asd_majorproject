import 'server-only';
import {timingSafeEqual} from 'node:crypto';
import {adminClient} from '../supabase/admin';
import {ApiError,databaseError,failure,ok} from '../api/errors';
import {endRoom,removeFromRoom,muteTrack} from './provider';

/** Scheduler-only endpoint. Jobs contain server-owned room/identity values, never request input. */
export async function recoverMedia(request:Request){try{
 const secret=process.env.MEDIA_WORKER_SECRET;
 if(!secret)throw new ApiError(503,'WORKER_SETUP','Media recovery is not configured.');
 const expected=Buffer.from('Bearer '+secret),supplied=Buffer.from(request.headers.get('authorization')||'');
 if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))throw new ApiError(401,'UNAUTHORIZED','Worker authentication required.');
 const db=adminClient();databaseError((await db.rpc('expire_live_meetings')).error);const delivered=await db.rpc('deliver_scheduled_messages');databaseError(delivered.error);const claimed=await db.rpc('claim_media_operations');databaseError(claimed.error);
 let completed=0,retry=0;
 for(const job of claimed.data||[]){
  let success=false;
  try{
   if(job.operation==='END'){
    const members=await db.from('meeting_members').select('user_id,meetings!inner(room_name)').eq('meetings.room_name',job.room_name);databaseError(members.error);
    await endRoom(job.room_name,(members.data||[]).map(member=>member.user_id));
   }
   else if(job.operation==='REMOVE')await removeFromRoom(job.room_name,job.user_id);
   else if(job.operation==='MUTE'&&job.track_sid)await muteTrack(job.room_name,job.user_id,job.track_sid);
   else throw new Error('Unsupported media operation');
   success=true;
  }catch(error){
   // A vanished microphone is already unable to transmit; never mute a newer publication instead.
   if(job.operation==='MUTE'&&error instanceof ApiError&&error.code==='INVALID_TRACK')success=true;
  }
  databaseError((await db.rpc('finish_media_operation',{p_id:job.id,p_lease:job.lease_token,p_success:success})).error);
  if(success)completed++;else retry++;
 }
 return ok({completed,retry,scheduledSent:delivered.data||0});
}catch(error){return failure(error)}}
