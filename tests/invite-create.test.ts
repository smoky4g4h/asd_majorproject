import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({actor:vi.fn(),admin:vi.fn(),config:vi.fn(),deliver:vi.fn()}));
vi.mock('../lib/auth/session',()=>({requireActor:m.actor}));
vi.mock('../lib/supabase/admin',()=>({adminClient:m.admin}));
vi.mock('../lib/invitations/email',()=>({emailConfig:m.config}));
vi.mock('../lib/invitations/delivery',()=>({deliverInvitation:m.deliver}));
import {ApiError} from '../lib/api/errors';
beforeEach(()=>{vi.resetAllMocks();m.config.mockImplementation(()=>{throw new Error('Gmail must not be required')});});
import {POST} from '../app/api/users/invite/route';
it('creates an email-bound link without configuring or sending Gmail',async()=>{
 const chain:any={update:vi.fn(),eq:vi.fn(),gt:vi.fn(),select:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:{id:'inv'},error:null})};for(const k of ['update','eq','gt','select'])chain[k].mockReturnValue(chain);
 const generateLink=vi.fn().mockResolvedValue({data:{user:{id:'u'}},error:null});
 m.admin.mockReturnValue({auth:{admin:{generateLink}},from:()=>chain});
 m.actor.mockResolvedValue({actor:{active:true,aal:'aal2',role:'PLATFORM_ADMIN',organizationId:'o'},db:{rpc:vi.fn().mockResolvedValueOnce({error:null}).mockResolvedValueOnce({data:{id:'inv',email:'member@example.com'},error:null})}});
 const r=await POST(new Request('http://localhost:3000/api/users/invite',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({email:'member@example.com',role:'MEMBER'})}));
 expect(r.status).toBe(201);const result=await r.json();expect(result.data.inviteUrl).toBe('http://localhost:3000/auth/accept-invite?invitation=inv');expect(result.data.deliveryStatus).toBe('MANUAL');expect(m.deliver).not.toHaveBeenCalled();expect(m.config).not.toHaveBeenCalled();expect(generateLink).toHaveBeenCalledWith({type:'invite',email:'member@example.com'});
});
