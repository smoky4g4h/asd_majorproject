import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({verifiedSession:vi.fn(),requireActor:vi.fn()}));
vi.mock('../lib/auth/session',()=>mocks);
import {POST} from '../app/api/auth/accept-invite/route';
import {ApiError} from '../lib/api/errors';
const req=(origin='http://localhost:3000',payload='{}')=>new Request('http://localhost:3000/api/auth/accept-invite',{method:'POST',headers:{origin,'content-type':'application/json'},body:payload});
describe('invitation acceptance endpoint',()=>{
 beforeEach(()=>vi.resetAllMocks());
 it('rejects anonymous callers',async()=>{mocks.verifiedSession.mockRejectedValue(new ApiError(401,'UNAUTHENTICATED','Sign in.'));expect((await POST(req())).status).toBe(401)});
 it('rejects foreign origins before accessing auth or database',async()=>{expect((await POST(req('https://foreign.example'))).status).toBe(403);expect(mocks.verifiedSession).not.toHaveBeenCalled()});
 it('does not accept a client supplied identity or role',async()=>{expect((await POST(req(undefined,'{"role":"PLATFORM_ADMIN"}'))).status).toBe(422);expect(mocks.verifiedSession).not.toHaveBeenCalled()});
 it('preserves MFA requirement instead of activating a privileged invitation',async()=>{const rpc=vi.fn().mockResolvedValueOnce({error:null}).mockResolvedValueOnce({data:null,error:{code:'42501',message:'MFA_REQUIRED'}});mocks.verifiedSession.mockResolvedValue({db:{rpc}});const r=await POST(req());expect(r.status).toBe(403);expect((await r.json()).error.code).toBe('MFA_REQUIRED')});
 it('returns an organization only after transactional acceptance',async()=>{const rpc=vi.fn().mockResolvedValueOnce({error:null}).mockResolvedValueOnce({data:'org',error:null});mocks.verifiedSession.mockResolvedValue({db:{rpc}});const r=await POST(req());expect(r.status).toBe(200);expect(await r.json()).toEqual({data:{organizationId:'org'},error:null});expect(r.headers.get('cache-control')).toContain('no-store')});
});
