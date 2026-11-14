import {ServerError,type RoomServiceClient} from 'livekit-server-sdk';
/** Revoke every issued identity, including members who already left, before deleting the room. */
export async function closeMediaRoom(service:RoomServiceClient,room:string,memberIds:string[]){
 let connected:string[]=[];
 try{connected=(await service.listParticipants(room)).map(person=>person.identity)}catch(error){if(!(error instanceof ServerError)||error.code!=='not_found')throw error}
 const identities=[...new Set([...memberIds,...connected])];
 for(let offset=0;offset<identities.length;offset+=10){
  await Promise.all(identities.slice(offset,offset+10).map(identity=>service.removeParticipant(room,identity,{revokeTokenTs:BigInt(Math.floor(Date.now()/1000)+1)})));
 }
 try{await service.deleteRoom(room)}catch(error){if(!(error instanceof ServerError)||error.code!=='not_found')throw error}
}
