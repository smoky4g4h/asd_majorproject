import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({rpc:vi.fn(),admin:vi.fn(),end:vi.fn(),remove:vi.fn(),mute:vi.fn()}));
vi.mock('../lib/supabase/admin',()=>({adminClient:mock.admin}));
vi.mock('../lib/meeting-media/provider',()=>({endRoom:mock.end,removeFromRoom:mock.remove,muteTrack:mock.mute}));
import {recoverMedia} from '../lib/meeting-media/recovery';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('MEDIA_WORKER_SECRET','worker-secret');mock.admin.mockReturnValue({rpc:mock.rpc,from:()=>({select:()=>({eq:async()=>({data:[{user_id:'user'}],error:null})})})});mock.rpc.mockResolvedValue({data:[],error:null})});
const request=(key='worker-secret')=>new Request('https://app.example/api/internal/media-recovery',{method:'POST',headers:{authorization:'Bearer '+key}});
it('rejects unauthorized invocation before accessing database',async()=>{expect((await recoverMedia(request('wrong'))).status).toBe(401);expect(mock.admin).not.toHaveBeenCalled()});
it('refuses to run without worker configuration',async()=>{vi.stubEnv('MEDIA_WORKER_SECRET','');expect((await recoverMedia(request())).status).toBe(503);expect(mock.admin).not.toHaveBeenCalled()});
it('acknowledges only successful provider operations',async()=>{
 mock.rpc.mockImplementation(async(name)=>({data:name==='claim_media_operations'?[{id:'job',lease_token:'lease',operation:'END',room_name:'room'}]:null,error:null}));
 const response=await recoverMedia(request());expect(response.status).toBe(200);expect(mock.end).toHaveBeenCalledWith('room',['user']);expect(mock.rpc).toHaveBeenCalledWith('finish_media_operation',{p_id:'job',p_lease:'lease',p_success:true});
});
it('requeues provider failure without disclosing credentials',async()=>{
 mock.rpc.mockImplementation(async(name)=>({data:name==='claim_media_operations'?[{id:'job',lease_token:'lease',operation:'REMOVE',room_name:'room',user_id:'user'}]:null,error:null}));mock.remove.mockRejectedValue(new Error('secret-provider-token'));
 const response=await recoverMedia(request());expect(mock.rpc).toHaveBeenCalledWith('finish_media_operation',{p_id:'job',p_lease:'lease',p_success:false});expect(await response.text()).not.toContain('secret-provider-token');
});
it('does not report success when acknowledgement fails',async()=>{mock.rpc.mockImplementation(async(name)=>name==='claim_media_operations'?{data:[{id:'job',lease_token:'lease',operation:'END',room_name:'room'}],error:null}:{error:{code:'XX000'}});expect((await recoverMedia(request())).status).toBe(503)});
