import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({actor:vi.fn()}));
vi.mock('../lib/auth/session',()=>({requireActor:m.actor}));
import {GET} from '../app/api/invitations/route';
import {ApiError} from '../lib/api/errors';
const actor={organizationId:'org-a',active:true,role:'ORG_ADMIN',aal:'aal2'};
const request=(query='')=>new Request('http://localhost:3000/api/invitations'+query);
beforeEach(()=>vi.resetAllMocks());
it('denies unauthenticated callers',async()=>{m.actor.mockRejectedValue(new ApiError(401,'UNAUTHENTICATED','Sign in.'));expect((await GET(request())).status).toBe(401)});
it('denies non-admin members before reading invitations',async()=>{const from=vi.fn();m.actor.mockResolvedValue({actor:{...actor,role:'MEMBER'},db:{from}});expect((await GET(request())).status).toBe(403);expect(from).not.toHaveBeenCalled()});
it('rejects invalid cursors',async()=>{m.actor.mockResolvedValue({actor,db:{}});expect((await GET(request('?cursor=invalid'))).status).toBe(422)});
it('scopes and bounds the query, hides identity bindings, and disables caching',async()=>{
 const chain:any={select:vi.fn(),eq:vi.fn(),order:vi.fn(),limit:vi.fn().mockResolvedValue({data:[{id:'i',email:'recipient@example.com',role:'MEMBER',status:'PENDING',expires_at:'2099-01-01T00:00:00Z',created_at:'2026-11-01T00:00:00Z',delivery_status:'PENDING',auth_user_id:'private-id'}],error:null})};for(const k of ['select','eq','order'])chain[k].mockReturnValue(chain);
 m.actor.mockResolvedValue({actor,db:{from:vi.fn().mockReturnValue(chain)}});
 const response=await GET(request());expect(response.status).toBe(200);const result=await response.json();expect(result.data.items[0].linkReady).toBe(true);expect(result.data.items[0].auth_user_id).toBeUndefined();expect(chain.eq).toHaveBeenCalledWith('organization_id','org-a');expect(chain.limit).toHaveBeenCalledWith(51);expect(response.headers.get('cache-control')).toContain('no-store');
});
