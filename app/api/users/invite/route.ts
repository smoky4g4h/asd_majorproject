import {z} from 'zod';
import {requireActor} from '../../../../lib/auth/session';
import {canManageMembers} from '../../../../lib/authz/policy';
import {adminClient} from '../../../../lib/supabase/admin';
import {body,role} from '../../../../lib/api/validation';
import {ApiError,databaseError,failure,ok} from '../../../../lib/api/errors';
import {appOrigin} from '../../../../lib/env';
export async function POST(request:Request){try{
 const input=await body(request,z.object({email:z.email().max(254).transform(v=>v.toLowerCase().trim()),role}).strict());
 const {db,actor}=await requireActor();if(!canManageMembers(actor))throw new ApiError(403,'FORBIDDEN','Only workspace administrators can invite members.');
 databaseError((await db.rpc('consume_rate_limit',{p_key:'invite'})).error);
 const admin=adminClient();
 // Create the approved invitation under caller authorization before using the Auth admin API.
 const invitation=await db.rpc('create_invitation',{p_org:actor.organizationId,p_email:input.email,p_role:input.role});
 if(invitation.error?.code==='23505'){
  const existing=await db.from('invitations').select('*').eq('organization_id',actor.organizationId).eq('email',input.email).eq('status','PENDING').gt('expires_at',new Date().toISOString()).maybeSingle();databaseError(existing.error);
  if(!existing.data||existing.data.role!==input.role)throw new ApiError(409,'CONFLICT','A pending invitation already exists. Use its original role or revoke it first.');
  invitation.data=existing.data;invitation.error=null;
 }
 databaseError(invitation.error);
 const record=invitation.data;
 // Provision an identity without delivering an email-token login. Google verifies the email.
 const prepared=record.auth_user_id?null:await admin.auth.admin.generateLink({type:'invite',email:record.email});
 let identity=record.auth_user_id?{id:record.auth_user_id}:prepared?.data?.user;
 if(!identity){
  // Existing Auth identities can be invited to a workspace too.
  for(let page=1;;page++){
   const listed=await admin.auth.admin.listUsers({page,perPage:1000});
   if(listed.error)break;
   identity=listed.data.users.find(user=>user.email?.toLowerCase()===record.email)??null;
   if(identity||listed.data.users.length<1000)break;
  }
 }
 if(!identity)throw new ApiError(502,'INVITATION_IDENTITY_FAILED','Could not prepare this account. The pending invitation has been retained.');
 // Bind only the identity returned by the Auth service; revoked/expired invitations stay unusable.
 const saved=await admin.from('invitations').update({auth_user_id:identity.id}).eq('id',record.id).eq('organization_id',actor.organizationId).eq('status','PENDING').gt('expires_at',new Date().toISOString()).select('id').maybeSingle();databaseError(saved.error);
 if(!saved.data)throw new ApiError(409,'INVITATION_CLOSED','This invitation was revoked or expired during delivery.');
 const deliveryStatus='MANUAL';
 return ok({id:record.id,status:'PENDING',deliveryStatus,inviteUrl:appOrigin()+'/auth/accept-invite?invitation='+encodeURIComponent(record.id)},201);
}catch(error){return failure(error)}}
