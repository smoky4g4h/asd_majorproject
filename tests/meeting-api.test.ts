import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({requireActor:vi.fn(),remove:vi.fn(),end:vi.fn(),mute:vi.fn()}));
vi.mock('../lib/auth/session',()=>({requireActor:mocks.requireActor}));
vi.mock('../lib/meeting-media/provider',()=>({mediaConfig:()=>({url:'wss://test.livekit.cloud',key:'testkey',secret:'test-secret-at-least-32-characters'}),removeFromRoom:mocks.remove,endRoom:mocks.end,muteTrack:mocks.mute}));
import {POST,GET} from '../app/api/meetings/[id]/[...action]/route';
import {TokenVerifier} from 'livekit-server-sdk';
import {ApiError} from '../lib/api/errors';
const id='00000000-0000-4000-8000-000000000001',uid='00000000-0000-4000-8000-000000000002';
const context=(action:string)=>({params:Promise.resolve({id,action:action.split('/')})});
const request=(data={},origin='http://localhost:3000')=>new Request('http://localhost:3000/api/meetings/'+id+'/room-token',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
let rpc:ReturnType<typeof vi.fn>;
beforeEach(()=>{vi.resetAllMocks();rpc=vi.fn(async(name:string)=>name==='meeting_action'?{data:{roomName:'private-room',identity:uid,meetingRole:'ATTENDEE',version:1,operationId:'op'},error:null}:{data:null,error:null});mocks.requireActor.mockResolvedValue({db:{rpc,from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id},error:null})};return q}},actor:{userId:uid,organizationId:id,role:'MEMBER',aal:'aal1',active:true},user:{id:uid}})});
describe('meeting lifecycle API',()=>{
 it('denies anonymous token requests',async()=>{mocks.requireActor.mockRejectedValue(new ApiError(401,'UNAUTHENTICATED','Sign in'));expect((await POST(request(),context('room-token'))).status).toBe(401)});
 it('rejects forged room or identity before authorization',async()=>{expect((await POST(request({roomName:'other',identity:'other'}),context('room-token'))).status).toBe(422);expect(mocks.requireActor).not.toHaveBeenCalled()});
 it('rejects cross-origin mutations',async()=>{expect((await POST(request({},'https://other.example'),context('start'))).status).toBe(403)});
 it('does not issue a token when database admission is denied',async()=>{rpc.mockResolvedValue({error:{code:'42501'}});const r=await POST(request(),context('room-token'));expect(r.status).toBe(403);expect(JSON.stringify(await r.json())).not.toContain('token"')});
 it('issues a signed five-minute token scoped to server identity and room',async()=>{const r=await POST(request(),context('room-token'));expect(r.status).toBe(200);const {data}=await r.json();const claims=await new TokenVerifier('testkey','test-secret-at-least-32-characters').verify(data.token);expect(claims.sub).toBe(uid);expect(claims.video?.room).toBe('private-room');expect(claims.video?.roomJoin).toBe(true);expect(claims.video?.roomAdmin).not.toBe(true);expect(claims.exp!-claims.nbf!).toBeLessThanOrEqual(300);expect(r.headers.get('cache-control')).toContain('no-store')});
 it('rejects a mismatched identity returned by permission check',async()=>{rpc.mockImplementation(async(name)=>name==='meeting_action'?{data:{roomName:'private-room',identity:id,meetingRole:'ATTENDEE',version:1},error:null}:{error:null});expect((await POST(request(),context('room-token'))).status).toBe(403)});
 it('refuses token if admission version changes while signing',async()=>{let reads=0;rpc.mockImplementation(async(name)=>name==='meeting_action'?{data:{roomName:'private-room',identity:uid,meetingRole:'ATTENDEE',version:++reads},error:null}:{error:null});expect((await POST(request(),context('room-token'))).status).toBe(409)});
 it('does not call provider on denied removal',async()=>{rpc.mockImplementation(async(name)=>name==='meeting_action'?{error:{code:'42501'}}:{error:null});expect((await POST(request({userId:id}),context('remove-participant'))).status).toBe(403);expect(mocks.remove).not.toHaveBeenCalled()});
 it('retains pending media operation and reports failure when removal fails',async()=>{mocks.remove.mockRejectedValue(new Error('provider secret'));const r=await POST(request({userId:id}),context('remove-participant'));expect(r.status).toBe(503);expect((await r.json()).error.code).toBe('MEDIA_PENDING');expect(rpc.mock.calls.some(([n])=>n==='complete_media_operation')).toBe(false)});
 it('marks removal complete only after provider confirms',async()=>{mocks.remove.mockResolvedValue(undefined);expect((await POST(request({userId:id}),context('remove-participant'))).status).toBe(200);expect(mocks.remove).toHaveBeenCalledWith('private-room',id);expect(rpc).toHaveBeenCalledWith('complete_media_operation',{p_id:'op'})});
 it('allows a host to rejoin an already-live room without restarting it',async()=>{rpc.mockImplementation(async(name,args)=>{if(name!=='meeting_action')return {error:null};if(args.p_action==='start')return {error:{code:'23514'}};return {data:{roomName:'private-room',identity:uid,meetingRole:'HOST',version:2},error:null}});expect((await POST(request(),context('start'))).status).toBe(200)});
 it('does not turn a refused start into success for attendees',async()=>{rpc.mockImplementation(async(name,args)=>{if(name!=='meeting_action')return {error:null};if(args.p_action==='start')return {error:{code:'23514'}};return {data:{roomName:'private-room',identity:uid,meetingRole:'ATTENDEE',version:2},error:null}});expect((await POST(request(),context('start'))).status).toBe(422)});
 it('unknown actions do not reach auth',async()=>{expect((await POST(request(),context('anything'))).status).toBe(404);expect(mocks.requireActor).not.toHaveBeenCalled()});
 it('does not expose arbitrary GET actions',async()=>{expect((await GET(request(),context('room-token'))).status).toBe(404)});
});

function admissionDb(host=false,removed=false){
 const queries:Record<string,ReturnType<typeof vi.fn>>={};
 const from=vi.fn((table:string)=>{
  const result=table==='meetings'?{id}:table==='meeting_members'?{meeting_role:host?'HOST':'ATTENDEE',removed_at:removed?'now':null}:[{id,user_id:uid,status:'PENDING'}];
  const query:any={select:vi.fn(()=>query),eq:vi.fn(()=>query),order:vi.fn(()=>query),limit:vi.fn(()=>query),maybeSingle:vi.fn(async()=>({data:result,error:null})),then:(resolve:any)=>Promise.resolve({data:result,error:null}).then(resolve)};
  queries[table]=query.eq;return query;
 });
 return {db:{from,rpc},queries};
}
it('attendee admission listing explicitly filters to own user ID',async()=>{const {db,queries}=admissionDb();mocks.requireActor.mockResolvedValue({db,actor:{userId:uid,organizationId:id,aal:'aal1'}});const result=await GET(request(),context('admission-requests'));expect(result.status).toBe(200);expect(queries.admission_requests).toHaveBeenCalledWith('user_id',uid)});
it('removed member cannot list admission requests',async()=>{const {db}=admissionDb(false,true);mocks.requireActor.mockResolvedValue({db,actor:{userId:uid,organizationId:id,aal:'aal1'}});expect((await GET(request(),context('admission-requests'))).status).toBe(403)});
it('host needs elevated assurance to list waiting participants',async()=>{const {db}=admissionDb(true);mocks.requireActor.mockResolvedValue({db,actor:{userId:uid,organizationId:id,aal:'aal1'}});expect((await GET(request(),context('admission-requests'))).status).toBe(403)});
it('verified host can list the meeting queue',async()=>{const {db,queries}=admissionDb(true);mocks.requireActor.mockResolvedValue({db,actor:{userId:uid,organizationId:id,aal:'aal2'}});expect((await GET(request(),context('admission-requests'))).status).toBe(200);expect(queries.admission_requests).not.toHaveBeenCalledWith('user_id',uid)});

it('returns the caller’s verified meeting role for lobby controls',async()=>{const {db}=admissionDb(true);mocks.requireActor.mockResolvedValue({db,actor:{userId:uid,organizationId:id,aal:'aal2'}});const response=await GET(request(),context('context'));expect(response.status).toBe(200);expect((await response.json()).data.meetingRole).toBe('HOST')});

it('ends with all saved member identities so departed tokens are revoked too',async()=>{
 const query:any={select:vi.fn(()=>query),eq:vi.fn(()=>query),maybeSingle:async()=>({data:{id},error:null}),then:(resolve:any)=>Promise.resolve({data:[{user_id:uid},{user_id:id}],error:null}).then(resolve)};
 mocks.requireActor.mockResolvedValue({db:{rpc,from:vi.fn(()=>query)},actor:{userId:uid,organizationId:id,aal:'aal2'}});
 const response=await POST(request(),context('end'));expect(response.status).toBe(200);expect(mocks.end).toHaveBeenCalledWith('private-room',[uid,id]);expect(query.eq).toHaveBeenCalledWith('organization_id',id);
});
