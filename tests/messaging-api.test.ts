import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}));
vi.mock('../lib/auth/session',()=>({requireActor:mock.auth}));
import {openChat,getMessages,postMessage} from '../lib/messaging/handlers';
import {ApiError} from '../lib/api/errors';
const id='00000000-0000-4000-8000-000000000001',recipient='00000000-0000-4000-8000-000000000002';
const context={params:Promise.resolve({id})};
function request(input?:unknown){return new Request('http://localhost:3000/api/chats/'+id+'/messages',{method:input?'POST':'GET',headers:{origin:'http://localhost:3000','content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})})}
beforeEach(()=>{vi.resetAllMocks();mock.auth.mockResolvedValue({db:{rpc:mock.rpc,from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id},error:null})};return q}},actor:{organizationId:id,userId:id}});mock.rpc.mockResolvedValue({data:[],error:null})});
it('rejects unauthenticated reads',async()=>{mock.auth.mockRejectedValue(new ApiError(401,'AUTH','Sign in'));expect((await getMessages(request(),context)).status).toBe(401)});
it('rejects forged message author before touching auth',async()=>{expect((await postMessage(request({body:'Hi',clientMessageId:recipient,authorId:id}),context)).status).toBe(422);expect(mock.auth).not.toHaveBeenCalled()});
it('derives the organization for a direct thread from the session',async()=>{await openChat(request({recipientId:recipient}));expect(mock.rpc).toHaveBeenCalledWith('open_direct_thread',{p_org:id,p_recipient:recipient})});
it('propagates membership denial without contents',async()=>{mock.rpc.mockResolvedValue({error:{code:'42501'}});expect((await getMessages(request(),context)).status).toBe(403)});
it('bounds a message page and returns a stable cursor',async()=>{mock.rpc.mockResolvedValue({data:Array.from({length:51},(_,i)=>({id:String(i)})),error:null});const response=await getMessages(request(),context);const result=await response.json();expect(result.data.messages).toHaveLength(50);expect(result.data.nextCursor).toBe('49')});
it('passes a send retry key to database and uses no-store',async()=>{const response=await postMessage(request({body:'Hello',clientMessageId:recipient}),context);expect(mock.rpc).toHaveBeenCalledWith('send_message',{p_thread:id,p_client:recipient,p_body:'Hello'});expect(response.headers.get('cache-control')).toContain('no-store')});

it('does not accept scheduled messages without a configured worker',async()=>{
 vi.stubEnv('CHAT_SCHEDULING_ENABLED','false');
 const {scheduledPOST}=await import('../lib/messaging/handlers');
 const response=await scheduledPOST(request({action:'schedule',clientMessageId:recipient,body:'Later',sendAt:new Date(Date.now()+600000).toISOString()}),context);
 expect(response.status).toBe(503);expect(mock.rpc).not.toHaveBeenCalledWith('schedule_message',expect.anything());
 vi.unstubAllEnvs();
});
it('maps concurrent edits to a conflict response',async()=>{
 const {changeMessage}=await import('../lib/messaging/handlers');
 mock.rpc.mockImplementation(async(name)=>name==='change_message'?{error:{code:'40001'}}:{error:null});
 const response=await changeMessage(request({messageId:recipient,action:'edit',body:'Changed',revision:1}),context);
 expect(response.status).toBe(409);
});
