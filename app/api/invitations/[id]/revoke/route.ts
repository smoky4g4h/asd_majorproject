import {z} from 'zod';
import {requireActor} from '../../../../../lib/auth/session';
import {body,uuid} from '../../../../../lib/api/validation';
import {ApiError,databaseError,failure,ok} from '../../../../../lib/api/errors';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{await body(request,z.object({}).strict());const {id}=await params;if(!uuid.safeParse(id).success)throw new ApiError(422,'INVALID','Invalid invitation identifier.');const {db}=await requireActor();databaseError((await db.rpc('consume_rate_limit',{p_key:'revoke-invitation'})).error);databaseError((await db.rpc('revoke_invitation',{p_id:id})).error);return ok({revoked:true})}catch(error){return failure(error)}}
