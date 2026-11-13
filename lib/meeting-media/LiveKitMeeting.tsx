'use client';

import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import ChatPanel from '../../components/ChatPanel';
import {useWorkspace} from '../../components/WorkspaceStore';
import {meetingTiles} from './layout';
import {
  ControlBar,LiveKitRoom,ParticipantTile,PreJoin,RoomAudioRenderer,StartAudio,
  useConnectionState,useParticipants,useSpeakingParticipants,useTracks,usePreviewTracks,useTrackVolume,
  type LocalUserChoices,
} from '@livekit/components-react';
import {ConnectionState,DisconnectReason,LocalAudioTrack,Track} from 'livekit-client';
import type {Meeting,User} from '../domain';
import '@livekit/components-styles';
import '../../app/live-meeting.css';

type Admission={id:string;user_id:string;display_name?:string;status:string};
type Credentials={token:string;serverUrl:string};
type Phase='setup'|'requesting'|'waiting'|'connecting'|'connected'|'left'|'denied';
type Props={meeting:Meeting;user:User;onRefresh?:()=>void;children?:ReactNode};

class MeetingRequestError extends Error {
  constructor(message:string,readonly status:number){super(message)}
}
async function rawRequest<T>(meetingId:string,action:string,body?:unknown,signal?:AbortSignal,organizationId?:string):Promise<T>{
  const response=await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/${action}`,{
    method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json',...(organizationId?{'x-workspace-id':organizationId}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
  });
  const envelope=await response.json().catch(()=>null);
  if(!response.ok||!envelope||envelope.error){
    const detail=typeof envelope?.error==='string'?envelope.error:envelope?.error?.message;
    throw new MeetingRequestError(detail||`Meeting request failed (${response.status}). Please retry.`,response.status);
  }
  return envelope.data as T;
}
function useMeetingRequest(){const {state}=useWorkspace();return useCallback(function request<T>(meetingId:string,action:string,body?:unknown,signal?:AbortSignal){return rawRequest<T>(meetingId,action,body,signal,state.organizationId)},[state.organizationId]);}
function message(error:unknown){return error instanceof Error?error.message:'The meeting service could not be reached. Please retry.'}
function statusOf(row:Admission){return row.status.toUpperCase()}
const approved=(row:Admission)=>['APPROVED','ADMITTED'].includes(statusOf(row));
const denied=(row:Admission)=>['REJECTED','DENIED','REMOVED','REVOKED'].includes(statusOf(row));

/** Media credentials are kept in memory and issued only by the authenticated server. */
export default function LiveKitMeeting({meeting,user,onRefresh,children}:Props){
  const request=useMeetingRequest();
  const [meetingRole,setMeetingRole]=useState(meeting.organizerId===user.id?'HOST':'ATTENDEE');
  const host=['HOST','COHOST'].includes(meetingRole);
  const [copied,setCopied]=useState(false),[expanded,setExpanded]=useState(false);
  useEffect(()=>{const controller=new AbortController();request<{meetingRole:string}>(meeting.id,'context',undefined,controller.signal).then(value=>{if(!controller.signal.aborted&&['HOST','COHOST','ATTENDEE'].includes(value.meetingRole))setMeetingRole(value.meetingRole)}).catch(()=>{});return()=>controller.abort()},[meeting.id,user.id]);
  useEffect(()=>{const changed=()=>setExpanded(!!document.fullscreenElement);document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed)},[]);
  const [phase,setPhase]=useState<Phase>('setup');
  const [choices,setChoices]=useState<LocalUserChoices>();
  const [credentials,setCredentials]=useState<Credentials>();
  const [error,setError]=useState('');
  const [mediaError,setMediaError]=useState('');
  const generation=useRef(0),busy=useRef(false);
  const refresh=useRef(onRefresh);refresh.current=onRefresh;
  useEffect(()=>()=>{generation.current++;busy.current=false},[]);
  const endLocal=useCallback((next:Phase,reason='')=>{
    generation.current++;busy.current=false;setCredentials(undefined);setPhase(next);setError(reason);
  },[]);
  const previewError=useCallback((error:Error)=>setMediaError(message(error)),[]);
  const connected=useCallback(()=>{setPhase('connected');setError('')},[]);
  const disconnected=useCallback((reason?:DisconnectReason)=>{
    endLocal(reason===DisconnectReason.PARTICIPANT_REMOVED?'denied':'left',reason===DisconnectReason.PARTICIPANT_REMOVED?'The host removed you from this meeting.':'You are disconnected. Rejoining requires a fresh permission check.');
  },[endLocal]);
  const connectionError=useCallback((error:Error)=>{
    if(['NotAllowedError','NotFoundError','NotReadableError','OverconstrainedError'].includes(error.name))setMediaError(message(error));
    else endLocal('left',message(error));
  },[endLocal]);
  useEffect(()=>{
    if(['CANCELLED','ENDED'].includes(meeting.state.toUpperCase()))endLocal('denied','This meeting has ended or was cancelled.');
  },[meeting.state,endLocal]);

  const getCredentials=useCallback(async(signal?:AbortSignal)=>{
    const value=await request<Credentials>(meeting.id,'room-token',{},signal);
    if(!value?.token||!value.serverUrl)throw new Error('The meeting server did not return room credentials.');
    return value;
  },[meeting.id]);

  async function join(values:LocalUserChoices){
    if(busy.current)return;
    busy.current=true;const attempt=++generation.current;
    setChoices(values);setError('');setMediaError('');setPhase('requesting');
    try{
      if(host){
        await request(meeting.id,'start',{});
        if(attempt!==generation.current)return;
        const value=await getCredentials();
        if(attempt!==generation.current)return;
        setCredentials(value);setPhase('connecting');refresh.current?.();
      }else{
        await request(meeting.id,'admission-request',{});
        if(attempt!==generation.current)return;
        setPhase('waiting');
      }
    }catch(error){
      if(attempt!==generation.current)return;
      setCredentials(undefined);setError(message(error));setPhase(error instanceof MeetingRequestError&&[401,403,410].includes(error.status)?'denied':'setup');
    }finally{if(attempt===generation.current)busy.current=false}
  }

  useEffect(()=>{
    if(phase!=='waiting')return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        const rows=await request<Admission[]>(meeting.id,'admission-requests',undefined,controller.signal);
        if(controller.signal.aborted)return;
        const own=rows.filter(row=>row.user_id===user.id);
        // The server returns current requests; a denial always wins over a stale approved row.
        if(own.some(denied)){endLocal('denied','Your request was declined or your access was removed.');return}
        if(own.some(approved)){
          const value=await getCredentials(controller.signal);
          if(controller.signal.aborted)return;
          setError('');setCredentials(value);setPhase('connecting');return;
        }
        setError('');
      }catch(error){
        if(controller.signal.aborted)return;
        if(error instanceof MeetingRequestError&&[401,403,410].includes(error.status)){endLocal('denied',message(error));return}
        setError(message(error));
      }
      if(!controller.signal.aborted)timer=setTimeout(poll,5000);
    };
    void poll();return()=>{controller.abort();clearTimeout(timer)};
  },[phase,meeting.id,user.id,getCredentials,endLocal]);

  const header=<header className="live-room-header"><div className="brand">SecureMeet</div><strong>{meeting.title}</strong><div className="live-header-actions"><button onClick={async()=>{try{await navigator.clipboard.writeText(location.origin+'/meetings/'+meeting.id);setCopied(true)}catch{setError('Unable to copy the meeting link. Open Meeting details to copy its address.')}}}>{copied?'Link copied':'Copy meeting link'}</button><button onClick={async event=>{const room=event.currentTarget.closest('.live-meeting') as HTMLElement|null;try{if(document.fullscreenElement)await document.exitFullscreen();else if(room?.requestFullscreen)await room.requestFullscreen();else setError('Full screen is not available in this browser.')}catch{setError('Unable to expand the meeting. You can continue in this window.')}}}>{expanded?'Exit full screen':'Expand meeting'}</button><Link href={'/meetings/'+meeting.id}>Meeting details</Link></div></header>;
  if(credentials&&choices)return <main className="room live-meeting live-call" data-lk-theme="default">{header}
    {error&&<p className="live-room-alert" role="alert">{error}</p>}
    {mediaError&&<p className="live-room-alert" role="alert">{mediaError} You can remain in the meeting with your camera and microphone off.</p>}
    <LiveKitRoom token={credentials.token} serverUrl={credentials.serverUrl} connect
      audio={choices.audioEnabled?{deviceId:choices.audioDeviceId}:false}
      video={choices.videoEnabled?{deviceId:choices.videoDeviceId}:false}
      onConnected={connected}
      onDisconnected={disconnected}
      onError={connectionError}
      onMediaDeviceFailure={(failure,kind)=>setMediaError(`${kind||'Media device'} unavailable${failure?': '+failure:''}.`)}>
      <ConnectedRoom meeting={meeting} host={host} onError={setError} onMediaError={setMediaError} onEnd={()=>{endLocal('left','The meeting has ended.');refresh.current?.()}}>{children}</ConnectedRoom>
    </LiveKitRoom>
  </main>;

  return <main className="room live-meeting" data-lk-theme="default">{header}<div className="room-columns live-lobby-columns">
    <aside><h3>Meeting agenda</h3>{meeting.agenda.map((item,index)=><p key={index}>{index+1}. {item}</p>)}</aside>
    <section className="live-lobby" aria-label="Meeting lobby">
      <h1>{phase==='waiting'?'Waiting for admission':phase==='denied'?'Room access unavailable':phase==='left'?'You have left the room':'Prepare to join'}</h1>
      <p>{host?'As a host, you can start the room and admit invited participants.':'Only invited participants admitted by the host can enter this room.'}</p>
      {error&&<p className="live-room-alert" role="alert">{error}</p>}
      {mediaError&&<p className="live-room-alert" role="alert">{mediaError} Turn off the unavailable device to continue without it.</p>}
      {phase==='setup'&&<><p>Camera and microphone start off. Enable them below to preview your devices, or join with both off.</p><PreJoin
        defaults={{username:user.name,audioEnabled:false,videoEnabled:false}}
        persistUserChoices={false} joinLabel={host?'Start and join meeting':'Request admission'} userLabel="Display name"
        onValidate={()=>true} onSubmit={join} onError={previewError}/><MicrophoneTest onError={previewError}/></>}
      {phase==='requesting'&&<p role="status">{host?'Starting the meeting…':'Submitting your admission request…'}</p>}
      {phase==='waiting'&&<><p role="status">Your request was saved. This page checks for the host’s decision every five seconds.</p><button onClick={()=>endLocal('left','You left the waiting screen. Your request remains visible to the host; no media connection was opened.')}>Leave waiting screen</button></>}
      {(phase==='left'||phase==='denied')&&!['CANCELLED','ENDED'].includes(meeting.state.toUpperCase())&&<button onClick={()=>{setError('');setPhase('setup')}}>Return to device setup</button>}
      <Link className="live-back" href={'/meetings/'+meeting.id}>Back to meeting details</Link>
    </section>
    <aside>{host?<AdmissionPanel meetingId={meeting.id}/>:<><h3>Room status</h3><p>{meeting.state==='LIVE'?'The meeting is marked live. Host approval is still required.':'The host has not marked this meeting live.'}</p><p>Devices are stopped while waiting for admission.</p></>}</aside>
  </div></main>;
}

function MicrophoneTest({onError}:{onError:(error:Error)=>void}){
  const [enabled,setEnabled]=useState(false);
  const failed=useCallback((error:Error)=>{setEnabled(false);onError(error)},[onError]);
  const tracks=usePreviewTracks({audio:enabled,video:false},failed);
  const audio=tracks?.find((track):track is LocalAudioTrack=>track instanceof LocalAudioTrack);
  const volume=useTrackVolume(enabled?audio:undefined);
  return <div className="live-microphone-test"><button type="button" aria-pressed={enabled} onClick={()=>setEnabled(value=>!value)}>{enabled?'Stop microphone test':'Test microphone level'}</button>{enabled&&<label>Microphone input <meter min={0} max={1} value={volume} aria-label="Microphone input level"/></label>}<small>This local test stops when you leave device setup.</small></div>;
}

function AdmissionPanel({meetingId}:{meetingId:string}){
 const request=useMeetingRequest();
  const {state}=useWorkspace();
  const [requests,setRequests]=useState<Admission[]>([]),[error,setError]=useState(''),[pending,setPending]=useState('');
  const [version,setVersion]=useState(0);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{const rows=await request<Admission[]>(meetingId,'admission-requests',undefined,controller.signal);if(!controller.signal.aborted){setRequests(rows);setError('')}}
      catch(error){if(!controller.signal.aborted)setError(message(error))}
      finally{if(!controller.signal.aborted)setLoading(false)}
      if(!controller.signal.aborted)timer=setTimeout(poll,5000);
    };
    void poll();return()=>{controller.abort();clearTimeout(timer)};
  },[meetingId,version]);
  async function decide(row:Admission,decision:'approve'|'reject'){
    if(pending)return;setPending(row.id);setError('');
    try{await request(meetingId,`admissions/${encodeURIComponent(row.id)}/${decision}`,{});setRequests(rows=>rows.filter(item=>item.id!==row.id));setVersion(value=>value+1)}
    catch(error){setError(message(error))}finally{setPending('')}
  }
  const waiting=requests.filter(row=>['PENDING','WAITING','REQUESTED'].includes(statusOf(row)));
  return <section className="live-admissions" aria-label="Host admission controls"><h3>Waiting room · {waiting.length}</h3>{loading&&<p role="status">Loading admission requests…</p>}{error&&<p role="alert">{error} <button onClick={()=>setVersion(value=>value+1)}>Retry</button></p>}{!loading&&!waiting.length&&!error&&<p>No pending requests.</p>}{waiting.map(row=><article key={row.id}><strong>{row.display_name||state.users.find(user=>user.id===row.user_id)?.name||'Invited participant'}</strong><small>{row.display_name||state.users.some(user=>user.id===row.user_id)?'':row.user_id}</small><div><button disabled={!!pending} onClick={()=>void decide(row,'approve')}>Admit</button><button disabled={!!pending} onClick={()=>void decide(row,'reject')}>Decline</button></div></article>)}</section>;
}

function ConnectedRoom({meeting,host,onError,onMediaError,onEnd,children}:{meeting:Meeting;host:boolean;onError:(message:string)=>void;onMediaError:(message:string)=>void;onEnd:()=>void;children?:ReactNode}){
  const request=useMeetingRequest();
  const participants=useParticipants(),speakers=useSpeakingParticipants(),connection=useConnectionState();
  const tracks=useTracks([{source:Track.Source.Camera,withPlaceholder:true},{source:Track.Source.ScreenShare,withPlaceholder:false}]);
  const [search,setSearch]=useState(''),[layout,setLayout]=useState('Grid'),[focus,setFocus]=useState(''),[pending,setPending]=useState(''),[showPeople,setShowPeople]=useState(true),[showChat,setShowChat]=useState(true);
  useEffect(()=>{const media=window.matchMedia('(max-width:1100px)');const adapt=()=>{if(media.matches){setShowPeople(false);setShowChat(false)}};adapt();media.addEventListener('change',adapt);return()=>media.removeEventListener('change',adapt)},[]);
  const displayed=meetingTiles(tracks,layout,focus,speakers.map(person=>person.identity));
  const selected=displayed[0],presenting=selected?.source===Track.Source.ScreenShare;
  async function moderate(action:string,body:unknown,key:string){
    if(pending)return;setPending(key);onError('');
    try{await request(meeting.id,action,body);if(action==='end')onEnd()}
    catch(error){onError(message(error))}finally{setPending('')}
  }
  return <><div className="live-connection" role="status">{connection===ConnectionState.Connected?'Connected':connection===ConnectionState.Reconnecting||connection===ConnectionState.SignalReconnecting?'Connection interrupted. Reconnecting…':'Connecting to the room…'}</div><div className="room-columns live-connected-columns" style={{gridTemplateColumns:(showPeople?'230px ':'')+'minmax(0,1fr)'+(showChat?' 300px':'')}}>
    <aside id="live-participants" className="live-participants" hidden={!showPeople}><button className="live-panel-close" aria-label="Close participants" onClick={()=>setShowPeople(false)}>Close</button><h3>Participants · {participants.length}</h3><input aria-label="Search participants" placeholder="Search participants" value={search} onChange={event=>setSearch(event.target.value)}/>{participants.filter(person=>(person.name||person.identity).toLowerCase().includes(search.toLowerCase())).map(person=>{const mic=person.getTrackPublication(Track.Source.Microphone);return <article className="live-person" key={person.identity}><span>{person.name||person.identity}{person.isLocal?' (You)':''}</span>{host&&!person.isLocal&&<div><button disabled={!!pending||!mic||mic.isMuted} onClick={()=>void moderate('mute-participant',{userId:person.identity,trackSid:mic?.trackSid},person.identity+'-mute')}>Mute microphone</button><button disabled={!!pending} onClick={()=>{if(confirm(`Remove ${person.name||person.identity} from this meeting?`))void moderate('remove-participant',{userId:person.identity},person.identity+'-remove')}}>Remove</button></div>}</article>})}{host&&<AdmissionPanel meetingId={meeting.id}/>}</aside>
    <section className="live-stage"><div className="toolbar"><span>{participants.length} connected participants</span><div className="spacer"/><button aria-expanded={showPeople} aria-controls="live-participants" onClick={()=>setShowPeople(!showPeople)}>Participants</button><button aria-expanded={showChat} aria-controls="live-chat" onClick={()=>setShowChat(!showChat)}>Chat</button>{['Grid','Speaker','Focus'].map(value=><button className={layout===value?'selected':''} aria-pressed={layout===value} key={value} onClick={()=>setLayout(value)}>{value}</button>)}</div>{layout==='Focus'&&<label className="live-focus-select">Focus participant<select value={focus||selected?.participant.identity||''} onChange={event=>setFocus(event.target.value)}>{participants.map(person=><option key={person.identity} value={person.identity}>{person.name||person.identity}</option>)}</select></label>}
      <div className={'live-track-grid live-layout-'+layout.toLowerCase()+(presenting?' live-presenting':'')}>{displayed.map(track=><ParticipantTile key={track.participant.identity+'-'+track.source} trackRef={track}/>)}</div>
      <RoomAudioRenderer/><StartAudio label="Enable meeting audio"/>
      <ControlBar variation="minimal" saveUserChoices={false} controls={{microphone:true,camera:true,screenShare:true,leave:true,chat:false,settings:false}} onDeviceError={({error})=>onMediaError(message(error))}/>
      {host&&<button className="live-end" disabled={!!pending} onClick={()=>{if(confirm('End this meeting for every participant?'))void moderate('end',{},'end')}}>End meeting for everyone</button>}
    </section>
    <aside id="live-chat" className="live-context" hidden={!showChat}><button className="live-panel-close" aria-label="Close chat" onClick={()=>setShowChat(false)}>Close</button>{children||<><ChatPanel meetingId={meeting.id} active={showChat}/><h2>Meeting resources</h2><p>{meeting.description}</p><h3>Agenda</h3>{meeting.agenda.map((item,index)=><p key={index}>{index+1}. {item}</p>)}<Link className="notice" href={'/meetings/'+meeting.id}>Meeting details and attachments</Link><Link className="notice" href="/tasks">Open action items</Link></>}</aside>
  </div></>;
}
