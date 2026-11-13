import {z} from 'zod';
import {requireActor} from '../../../lib/auth/session';
import {canManageMembers} from '../../../lib/authz/policy';
import {ApiError,databaseError,failure,ok} from '../../../lib/api/errors';
import {appOrigin} from '../../../lib/env';
const cursorSchema=z.object({created_at:z.iso.datetime({offset:true}),id:z.uuid()}).strict();
export async function GET(request:Request){
 try{
  const {db,actor}=await requireActor();
  if(!canManageMembers(actor))throw new ApiError(403,'FORBIDDEN','Only workspace administrators can view invitations.');
  const raw=new URL(request.url).searchParams.get('cursor');
  let cursor:z.infer<typeof cursorSchema>|undefined;
  if(raw){try{if(raw.length>512)throw Error();cursor=cursorSchema.parse(JSON.parse(Buffer.from(raw,'base64url').toString('utf8')))}catch{throw new ApiError(422,'INVALID_CURSOR','Refresh the invitation list to start again.')}}
  let query=db.from('invitations').select('id,email,role,status,delivery_status,created_at,expires_at,auth_user_id').eq('organization_id',actor.organizationId).order('created_at',{ascending:false}).order('id',{ascending:false});
  if(cursor)query=query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  const result=await query.limit(51);databaseError(result.error);
  const rows=result.data||[];const page=rows.slice(0,50);const last=page.at(-1);
  return ok({items:page.map(({auth_user_id,...item})=>({...item,linkReady:!!auth_user_id,status:item.status==='PENDING'&&Date.parse(item.expires_at)<=Date.now()?'EXPIRED':item.status})),nextCursor:rows.length>50&&last?Buffer.from(JSON.stringify({created_at:last.created_at,id:last.id})).toString('base64url'):null,inviteUrl:appOrigin()+'/auth/accept-invite'});
 }catch(error){return failure(error)}
}
