import {z} from 'zod';
import {requireActor,verifiedSession} from '../../../lib/auth/session';
import {body} from '../../../lib/api/validation';
import {databaseError,failure,ok} from '../../../lib/api/errors';
export async function GET(){try{const {db,user,actor}=await requireActor();const result=await db.from('profiles').select('id,full_name,avatar_path,status').eq('id',actor.userId).single();databaseError(result.error);return ok({actor,profile:result.data,email:user.email})}catch(error){return failure(error)}}
export async function PATCH(request:Request){try{const value=await body(request,z.object({name:z.string().trim().min(1).max(160)}).strict());const {db}=await verifiedSession();databaseError((await db.rpc('consume_rate_limit',{p_key:'profile'})).error);databaseError((await db.rpc('update_profile',{p_name:value.name})).error);return ok({saved:true})}catch(error){return failure(error)}}
