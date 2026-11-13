import {afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {emailConfig,sendInvitationEmail} from '../lib/invitations/email';
const config={clientId:'client',clientSecret:'secret',refreshToken:'refresh',sender:'sender@gmail.com',from:'AICTE SecureMeet <sender@gmail.com>',inviteUrl:'https://secure.example/auth/accept-invite'};
const payload={from:config.from,to:['guest@example.com'],subject:'Invitation',text:'Continue with Google at https://secure.example/auth/accept-invite'};
const attempt='00000000-0000-4000-8000-000000000123';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('requires Gmail OAuth credentials and a public HTTPS app URL',()=>{
 vi.stubEnv('GMAIL_CLIENT_ID','');expect(()=>emailConfig()).toThrow(/configure/i);
 vi.stubEnv('GMAIL_CLIENT_ID','client');vi.stubEnv('GMAIL_CLIENT_SECRET','secret');vi.stubEnv('GMAIL_REFRESH_TOKEN','refresh');vi.stubEnv('GMAIL_SENDER_EMAIL','sender@gmail.com');vi.stubEnv('NEXT_PUBLIC_APP_URL','http://localhost:3000');expect(()=>emailConfig()).toThrow(/public HTTPS/i);
 vi.stubEnv('NEXT_PUBLIC_APP_URL','https://secure.example');expect(emailConfig()).toEqual(config);
});
it('refreshes server-side OAuth credentials and sends a base64url MIME message through Gmail',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'access',token_type:'Bearer'})).mockResolvedValueOnce(Response.json({id:'gmail-id'}));vi.stubGlobal('fetch',fetcher);
 expect(await sendInvitationEmail(config,attempt,payload)).toEqual({providerId:'gmail-id'});
 const [tokenURL,tokenInit]=fetcher.mock.calls[0];expect(tokenURL).toBe('https://oauth2.googleapis.com/token');
 expect(new URLSearchParams(tokenInit.body).get('grant_type')).toBe('refresh_token');expect(new URLSearchParams(tokenInit.body).get('client_secret')).toBe('secret');
 const [url,init]=fetcher.mock.calls[1];expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');expect(init.headers.Authorization).toBe('Bearer access');
 const raw=JSON.parse(init.body).raw;expect(raw).not.toMatch(/[+/=]/);
 const mime=Buffer.from(raw,'base64url').toString();expect(mime).toContain('To: guest@example.com\r\n');expect(mime).toContain('From: '+config.from+'\r\n');expect(mime).toContain('Message-ID: <'+attempt+'@securemeet.invalid>');
 expect(Buffer.from(mime.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString()).toBe(payload.text);
 expect(init.body).not.toContain('refresh');expect(init.headers['Idempotency-Key']).toBeUndefined();
});
it('treats revoked OAuth credentials as a safe failure before sending',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({error:'invalid_grant',error_description:'private detail'},{status:400}));vi.stubGlobal('fetch',fetcher);
 await expect(sendInvitationEmail(config,attempt,payload)).rejects.toMatchObject({code:'GMAIL_AUTH_FAILED'});expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([400,401,403,429])('treats a Gmail HTTP %s rejection as retryable after correction',async status=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({access_token:'access'})).mockResolvedValueOnce(Response.json({error:{message:'private'}},{status})));
 await expect(sendInvitationEmail(config,attempt,payload)).rejects.toMatchObject({code:'EMAIL_DELIVERY_FAILED'});
});
it.each(['timeout','server-error','invalid-response'])('does not retry automatically after an uncertain Gmail %s',async scenario=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'access'}));
 if(scenario==='timeout')fetcher.mockRejectedValueOnce(Error('timeout'));
 else fetcher.mockResolvedValueOnce(Response.json({}, {status:scenario==='server-error'?500:200}));
 vi.stubGlobal('fetch',fetcher);
 await expect(sendInvitationEmail(config,attempt,payload)).rejects.toMatchObject({code:'EMAIL_DELIVERY_UNCERTAIN'});
});
it('rejects header injection before requesting an access token',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(sendInvitationEmail(config,attempt,{...payload,subject:'Invite\r\nBcc: other@example.com'})).rejects.toMatchObject({code:'EMAIL_PAYLOAD_INVALID'});expect(fetcher).not.toHaveBeenCalled();
});
