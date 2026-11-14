import {beforeEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {AccessToken} from 'livekit-server-sdk';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({admin:vi.fn(),rpc:vi.fn()}));
vi.mock('../lib/supabase/admin',()=>({adminClient:mock.admin}));
vi.mock('../lib/meeting-media/provider',()=>({mediaConfig:()=>({url:'wss://fixture.example',key:'fixture',secret:'fixture-secret-at-least-32-characters'})}));
import {livekitWebhook} from '../lib/meeting-media/webhook';
beforeEach(()=>{vi.resetAllMocks();mock.admin.mockReturnValue({rpc:mock.rpc});mock.rpc.mockResolvedValue({error:null})});
async function request(tamper=false){const payload=JSON.stringify({id:'event-one',event:'room_started',createdAt:Math.floor(Date.now()/1000).toString(),room:{name:'room-one',sid:'RM_one'}});const token=new AccessToken('fixture','fixture-secret-at-least-32-characters',{ttl:60});token.sha256=createHash('sha256').update(payload).digest('base64');return new Request('https://app.example/api/webhooks/livekit',{method:'POST',headers:{'content-type':'application/webhook+json',authorization:await token.toJwt()},body:tamper?payload.replace('room-one','room-forged'):payload})}
it('authenticates raw body before any privileged database access',async()=>{expect((await livekitWebhook(await request(true))).status).toBe(401);expect(mock.admin).not.toHaveBeenCalled()});
it('accepts a genuinely signed SDK event and stores only minimal metadata',async()=>{expect((await livekitWebhook(await request())).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('record_livekit_event',expect.objectContaining({p_id:'event-one',p_room:'room-one',p_sid:'RM_one'}));expect(Object.keys(mock.rpc.mock.calls[0][1])).not.toContain('body')});
it('returns retryable failure if event persistence fails',async()=>{mock.rpc.mockResolvedValue({error:{code:'XX000'}});expect((await livekitWebhook(await request())).status).toBe(503)});
it('rejects a missing signature',async()=>{const req=await request();req.headers.delete('authorization');expect((await livekitWebhook(req)).status).toBe(401);expect(mock.admin).not.toHaveBeenCalled()});
