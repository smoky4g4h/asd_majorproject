import {beforeEach,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('../lib/invitations/email',()=>({emailConfig:()=>({clientId:'client',clientSecret:'private-secret',refreshToken:'refresh',sender:'sender@gmail.com',from:'AICTE SecureMeet <sender@gmail.com>',inviteUrl:'https://secure.example/auth/accept-invite'}),sendInvitationEmail:m.send}));
import {ApiError} from '../lib/api/errors';
import {deliverInvitation} from '../lib/invitations/delivery';
const invitation={id:'inv',email:'guest@example.com',role:'MEMBER',expires_at:'2099-01-01T00:00:00Z'};
beforeEach(()=>vi.resetAllMocks());
it.each(['SENT','BUSY','UNKNOWN'])('does not call provider for %s attempts',async status=>{
 const rpc=vi.fn().mockResolvedValue({data:{status},error:null});
 expect(await deliverInvitation({rpc} as unknown as SupabaseClient,'org',invitation)).toBe(status==='BUSY'?'PENDING':status);
 expect(m.send).not.toHaveBeenCalled();
});
it.each([true,false])('persists the outcome before reporting delivery (provider accepted: %s)',async accepted=>{
 const stored={from:'old-sender@example.com',text:'immutable original message'};
 const rpc=vi.fn().mockResolvedValueOnce({data:{status:'CLAIMED',id:'attempt',lease:'lease',payload:stored}}).mockResolvedValueOnce({data:true});
 if(accepted)m.send.mockResolvedValue({providerId:'provider-id'});else m.send.mockRejectedValue(new ApiError(502,'EMAIL_DELIVERY_FAILED','Rejected'));
 expect(await deliverInvitation({rpc} as unknown as SupabaseClient,'org',invitation)).toBe(accepted?'SENT':'FAILED');
 expect(m.send).toHaveBeenCalledWith(expect.objectContaining({clientId:'client',refreshToken:'refresh'}),'attempt',stored);
 expect(rpc).toHaveBeenLastCalledWith('finish_invitation_email',{p_org:'org',p_invitation:'inv',p_attempt:'attempt',p_lease:'lease',p_provider_id:accepted?'provider-id':null,p_uncertain:false});
 const payload=rpc.mock.calls[0][1].p_payload;expect(payload.text).toContain('Continue with Google using guest@example.com');expect(payload.text).not.toContain('token');
});
it('does not claim success if persisting provider acceptance fails',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{status:'CLAIMED',id:'attempt',lease:'lease',payload:{}}}).mockResolvedValueOnce({error:{message:'database down'}});
 m.send.mockResolvedValue({providerId:'provider-id'});
 await expect(deliverInvitation({rpc} as unknown as SupabaseClient,'org',invitation)).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE'});
});

it('persists uncertainty so an ambiguous Gmail send is never automatically retried',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{status:'CLAIMED',id:'attempt',lease:'lease',payload:{}}}).mockResolvedValueOnce({data:true});
 m.send.mockRejectedValue(new ApiError(502,'EMAIL_DELIVERY_UNCERTAIN','Timeout'));
 expect(await deliverInvitation({rpc} as unknown as SupabaseClient,'org',invitation)).toBe('UNKNOWN');
 expect(rpc).toHaveBeenLastCalledWith('finish_invitation_email',expect.objectContaining({p_provider_id:null,p_uncertain:true}));
});
