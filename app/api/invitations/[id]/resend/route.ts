import {z} from 'zod';
import {requireActor} from '../../../../../lib/auth/session';
import {canManageMembers} from '../../../../../lib/authz/policy';
import {adminClient} from '../../../../../lib/supabase/admin';
import {body} from '../../../../../lib/api/validation';
import {ApiError,databaseError,failure,ok} from '../../../../../lib/api/errors';
import {deliverInvitation} from '../../../../../lib/invitations/delivery';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  await body(request,z.object({}).strict());
  const parsed=z.uuid().safeParse((await params).id);
  if(!parsed.success)throw new ApiError(422,'INVALID','Invalid invitation.');
  const {db,actor}=await requireActor();
  if(!canManageMembers(actor))throw new ApiError(403,'FORBIDDEN','Only workspace administrators can send invitations.');
  databaseError((await db.rpc('consume_rate_limit',{p_key:'invite'})).error);
  const found=await db.from('invitations').select('id,email,role,expires_at,status,auth_user_id').eq('id',parsed.data).eq('organization_id',actor.organizationId).maybeSingle();
  databaseError(found.error);
  if(!found.data)throw new ApiError(404,'NOT_FOUND','Invitation unavailable.');
  if(found.data.status!=='PENDING'||Date.parse(found.data.expires_at)<=Date.now())throw new ApiError(409,'INVITATION_CLOSED','This invitation is no longer pending.');
  if(!found.data.auth_user_id)throw new ApiError(409,'INVITATION_NOT_PREPARED','Use Invite user with the same email and role to finish preparing this account.');
  const deliveryStatus=await deliverInvitation(adminClient(),actor.organizationId,found.data,true);
  return ok({deliveryStatus});
 }catch(error){return failure(error);}
}
