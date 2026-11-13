import {z} from 'zod';
import {verifiedSession} from '../../../../lib/auth/session';
import {body,uuid} from '../../../../lib/api/validation';
import {ApiError,databaseError,failure,ok} from '../../../../lib/api/errors';
export async function POST(request:Request){try{const input=await body(request,z.object({invitationId:uuid.optional()}).strict());const {db}=await verifiedSession();const limit=await db.rpc('consume_rate_limit',{p_key:'accept-invitation'});databaseError(limit.error);const result=input.invitationId?await db.rpc('accept_selected_invitation',{p_id:input.invitationId}):await db.rpc('accept_invitation');if(result.error?.message.includes('MFA_REQUIRED'))throw new ApiError(403,'MFA_REQUIRED','Set up and verify your authenticator before accepting this invitation.');databaseError(result.error);return ok({organizationId:result.data})}catch(error){return failure(error)}}
