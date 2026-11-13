export type ChatMessage={id:string;author_id:string;body:string;created_at:string;deleted_at:string|null;updated_at?:string|null;revision?:number;client_message_id?:string|null};
export function mergeMessages(previous:ChatMessage[],incoming:ChatMessage[]){
 const map=new Map(previous.map(row=>[row.id,row]));
 for(const row of incoming){const old=map.get(row.id);if(!old||(row.revision??1)>=(old.revision??1))map.set(row.id,row)}
 return [...map.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)).slice(-500);
}
