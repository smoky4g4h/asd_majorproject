import 'server-only';
import {RoomServiceClient,TrackSource,ServerError} from 'livekit-server-sdk';
import {closeMediaRoom} from './lifecycle';
import {ApiError} from '../api/errors';
export function mediaConfig(){
 const url=process.env.LIVEKIT_URL,key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
 if(!url||!key||!secret)throw new ApiError(503,'MEDIA_SETUP','The meeting service is not configured.');
 try{if(new URL(url).protocol!=='wss:')throw Error()}catch{throw new ApiError(503,'MEDIA_SETUP','The meeting service requires a secure connection.')}
 return {url,key,secret};
}
function client(){const c=mediaConfig();return new RoomServiceClient(c.url.replace(/^wss:/,'https:'),c.key,c.secret,{requestTimeout:8,failover:false})}
export async function removeFromRoom(room:string,identity:string){await client().removeParticipant(room,identity,{revokeTokenTs:BigInt(Math.floor(Date.now()/1000)+1)})}
export async function endRoom(room:string,memberIds:string[]=[]){await closeMediaRoom(client(),room,memberIds)}
export async function muteTrack(room:string,identity:string,trackSid:string){
 const service=client();let person;try{person=await service.getParticipant(room,identity)}catch(error){if(error instanceof ServerError&&error.code==='not_found')throw new ApiError(422,'INVALID_TRACK','This microphone is no longer connected.');throw error}
 if(!person.tracks.some(track=>track.sid===trackSid&&track.source===TrackSource.MICROPHONE))throw new ApiError(422,'INVALID_TRACK','Select the participant’s current microphone track.');
 await service.mutePublishedTrack(room,identity,trackSid,true);
}
