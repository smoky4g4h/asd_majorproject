import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ApiError,databaseError} from '../api/errors';
import {emailConfig,sendInvitationEmail} from './email';

type Invitation={id:string;email:string;role:string;expires_at:string};
const roles:Record<string,string>={MEMBER:'Member',RESTRICTED_MEMBER:'Restricted member',ORGANIZER:'Organizer',ORG_ADMIN:'Administrator'};
export async function deliverInvitation(admin:SupabaseClient,organizationId:string,invitation:Invitation,resend=false){
 const config=emailConfig();
 const payload={from:config.from,to:[invitation.email],subject:'You are invited to AICTE SecureMeet',text:[
  'You have been invited to AICTE SecureMeet.',
  `Role: ${roles[invitation.role]||invitation.role}.`,
  `Open ${config.inviteUrl}`,
  `Continue with Google using ${invitation.email}, then accept your invitation.`,
  `This invitation expires at ${new Date(invitation.expires_at).toISOString()}.`,
  'Organizer and administrator accounts must set up two-factor authentication.',
  'If you were not expecting this invitation, you can ignore this email.',
 ].join('\n\n')};
 const claimed=await admin.rpc('claim_invitation_email',{p_org:organizationId,p_invitation:invitation.id,p_payload:payload,p_resend:resend});
 if(claimed.error?.message?.includes('email_resend_cooldown'))throw new ApiError(429,'EMAIL_COOLDOWN','Wait one minute before resending this invitation.');
 databaseError(claimed.error);
 const attempt=claimed.data;
 if(attempt.status==='SENT')return 'SENT' as const;
 if(attempt.status==='BUSY')return 'PENDING' as const;
 if(attempt.status==='UNKNOWN')return 'UNKNOWN' as const;
 if(attempt.status!=='CLAIMED')throw new ApiError(503,'EMAIL_UNAVAILABLE','Email delivery is unavailable. Retry from Invitations.');
 let providerId:string|null=null,uncertain=false;
 try{providerId=(await sendInvitationEmail(config,attempt.id,attempt.payload)).providerId;}
 catch(error){uncertain=!(error instanceof ApiError&&['GMAIL_AUTH_FAILED','EMAIL_DELIVERY_FAILED','EMAIL_PAYLOAD_INVALID'].includes(error.code));}
 const finished=await admin.rpc('finish_invitation_email',{p_org:organizationId,p_invitation:invitation.id,p_attempt:attempt.id,p_lease:attempt.lease,p_provider_id:providerId,p_uncertain:uncertain});
 databaseError(finished.error);
 if(!finished.data)return 'PENDING' as const;
 return providerId?'SENT' as const:uncertain?'UNKNOWN' as const:'FAILED' as const;
}
