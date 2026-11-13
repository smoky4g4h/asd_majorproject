import 'server-only';
import {z} from 'zod';
import {ApiError} from '../api/errors';

export function emailConfig(){
 const clientId=process.env.GMAIL_CLIENT_ID?.trim(),clientSecret=process.env.GMAIL_CLIENT_SECRET?.trim(),refreshToken=process.env.GMAIL_REFRESH_TOKEN?.trim(),sender=process.env.GMAIL_SENDER_EMAIL?.trim();
 if(!clientId||!clientSecret||!refreshToken||!sender||!z.email().safeParse(sender).success){
  throw new ApiError(503,'EMAIL_NOT_CONFIGURED','Configure GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN and GMAIL_SENDER_EMAIL before sending invitations.');
 }
 let origin:URL;
 try{origin=new URL(process.env.NEXT_PUBLIC_APP_URL||'');}catch{throw new ApiError(503,'EMAIL_APP_URL','Set NEXT_PUBLIC_APP_URL to the public HTTPS address of this app.');}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.hostname==='localhost'||origin.hostname.endsWith('.localhost')||!origin.hostname.includes('.')||/^\d+\.\d+\.\d+\.\d+$/.test(origin.hostname)){
  throw new ApiError(503,'EMAIL_APP_URL','Set NEXT_PUBLIC_APP_URL to the public HTTPS address of this app.');
 }
 return {clientId,clientSecret,refreshToken,sender,from:`AICTE SecureMeet <${sender}>`,inviteUrl:origin.origin+'/auth/accept-invite'};
}
export type GmailConfig=ReturnType<typeof emailConfig>;
const header=z.string().min(1).max(200).regex(/^[^\r\n]+$/);
const messageSchema=z.object({from:header,to:z.array(z.email()).length(1),subject:header,text:z.string().max(20_000)}).strict();
const uncertain=()=>new ApiError(502,'EMAIL_DELIVERY_UNCERTAIN','Gmail delivery is uncertain. Check the sender’s Sent folder before sending another invitation.');

export async function sendInvitationEmail(config:GmailConfig,attemptId:string,payload:unknown):Promise<{providerId:string}>{
 const parsed=messageSchema.safeParse(payload);
 if(!parsed.success||parsed.data.from!==config.from||!z.uuid().safeParse(attemptId).success){
  throw new ApiError(503,'EMAIL_PAYLOAD_INVALID','The stored email does not match the Gmail sender configuration. Review it before retrying.');
 }
 const message=parsed.data;
 // This stable Message-ID helps operators find the message. Gmail does not
 // promise to deduplicate messages.send requests with matching Message-IDs.
 const mime=[`From: ${message.from}`,`To: ${message.to[0]}`,`Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,
  `Message-ID: <${attemptId}@securemeet.invalid>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
  Buffer.from(message.text).toString('base64').match(/.{1,76}/g)?.join('\r\n')||'',
 ].join('\r\n');
 let accessToken:string;
 try{
  const response=await fetch('https://oauth2.googleapis.com/token',{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'}).toString(),signal:AbortSignal.timeout(10_000),
  });
  const token=await response.json();
  if(!response.ok||typeof token.access_token!=='string'||!token.access_token)throw Error('OAuth authorization failed');
  accessToken=token.access_token;
 }catch{throw new ApiError(502,'GMAIL_AUTH_FAILED','Gmail authorization failed before sending. Check the sender OAuth credentials and reconnect if the refresh token expired.');}
 // Once this request starts, a timeout or server error can hide a successful
 // delivery. The outbox must stop automatic retries for those uncertain cases.
 let response:Response;
 try{
  response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
   method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
   body:JSON.stringify({raw:Buffer.from(mime).toString('base64url')}),signal:AbortSignal.timeout(10_000),
  });
 }catch{throw uncertain();}
 if(!response.ok){
  if([400,401,403,404,413,422,429].includes(response.status))throw new ApiError(502,'EMAIL_DELIVERY_FAILED','Gmail rejected the email. Check Gmail API access, sending permission and account limits before retrying.');
  throw uncertain();
 }
 try{
  const result=await response.json();
  if(typeof result.id!=='string'||!result.id)throw Error('Missing Gmail message ID');
  return {providerId:result.id};
 }catch{throw uncertain();}
}
