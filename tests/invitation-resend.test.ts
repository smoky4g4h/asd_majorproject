import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({actor:vi.fn(),deliver:vi.fn(),admin:vi.fn()}));
vi.mock('../lib/auth/session',()=>({requireActor:m.actor}));
vi.mock('../lib/invitations/delivery',()=>({deliverInvitation:m.deliver}));
vi.mock('../lib/supabase/admin',()=>({adminClient:m.admin}));
import {POST} from '../app/api/invitations/[id]/resend/route';
const id='00000000-0000-4000-8000-000000000123';
const request=()=>new Request('http://localhost:3000/api/invitations/'+id+'/resend',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:'{}'});
const params={params:Promise.resolve({id})};
const actor={active:true,role:'ORG_ADMIN',aal:'aal2',organizationId:'org'};
beforeEach(()=>vi.resetAllMocks());
it('denies ordinary members before touching privileged delivery',async()=>{
 m.actor.mockResolvedValue({actor:{...actor,role:'MEMBER'},db:{}});
 expect((await POST(request(),params)).status).toBe(403);expect(m.admin).not.toHaveBeenCalled();expect(m.deliver).not.toHaveBeenCalled();
});
it.each(['REVOKED','ACCEPTED','EXPIRED','FOREIGN','PENDING'])('checks scoped invitation state %s before delivery',async status=>{
 const invitation=status==='FOREIGN'?null:{id,status:status==='EXPIRED'?'PENDING':status,auth_user_id:'user',expires_at:status==='EXPIRED'?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z'};
 const query:any={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:invitation})};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);
 m.actor.mockResolvedValue({actor,db:{rpc:vi.fn().mockResolvedValue({}),from:()=>query}});m.admin.mockReturnValue('server-client');m.deliver.mockResolvedValue('SENT');
 const response=await POST(request(),params);expect(query.eq).toHaveBeenCalledWith('organization_id','org');
 expect(response.status).toBe(status==='PENDING'?200:status==='FOREIGN'?404:409);
 if(status==='PENDING')expect(m.deliver).toHaveBeenCalledWith('server-client','org',invitation,true);else expect(m.deliver).not.toHaveBeenCalled();
});
