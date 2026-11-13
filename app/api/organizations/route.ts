import {cookies} from 'next/headers';
import {z} from 'zod';
import {requireActor} from '../../../lib/auth/session';
import {body,uuid} from '../../../lib/api/validation';
import {ApiError,databaseError,failure,ok} from '../../../lib/api/errors';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('switch'),organizationId:uuid}).strict(),
 z.object({action:z.literal('create'),name:z.string().trim().min(1).max(160),icon:z.enum(['orange','purple','blue','green','pink','teal'])}).strict(),
 z.object({action:z.literal('member'),organizationId:uuid,userId:uuid,role:z.enum(['ORG_ADMIN','ORGANIZER','MEMBER','RESTRICTED_MEMBER']),active:z.boolean()}).strict(),
]);
export async function POST(request:Request){try{
 const value=await body(request,input);
 const {db,actor}=await requireActor(value.action==='switch'?value.organizationId:undefined);
 databaseError((await db.rpc('consume_rate_limit',{p_key:'organization-write'})).error);
 let id=actor.organizationId;
 if(value.action==='create'){const result=await db.rpc('create_organization',{p_source:actor.organizationId,p_name:value.name,p_icon:value.icon});databaseError(result.error);id=result.data;}
 if(value.action==='member'){const result=await db.rpc('manage_organization_member',{p_source:actor.organizationId,p_target:value.organizationId,p_user:value.userId,p_role:value.role,p_active:value.active});if(result.error?.code==='22023'&&result.error.message.includes('live meetings'))throw new ApiError(409,'LIVE_MEETING','End this member’s live meetings before changing their access.');databaseError(result.error);return ok({saved:true});}
 (await cookies()).set('securemeet-organization',id,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:60*60*24*365});
 return ok({organizationId:id});
 }catch(error){return failure(error)}}
