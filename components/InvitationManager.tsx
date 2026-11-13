'use client';
import {useWorkspace} from './WorkspaceStore';
import {useRef,useState} from 'react';

type Invitation={id:string;email:string;role:string;status:string;delivery_status:string;expires_at:string;linkReady:boolean};
const roleNames:Record<string,string>={ORG_ADMIN:'Administrator',ORGANIZER:'Organizer',MEMBER:'Member',RESTRICTED_MEMBER:'Restricted member'};
export default function InvitationManager({role}:{role:string}){
 const {state}=useWorkspace();
 const dialog=useRef<HTMLDialogElement>(null);
 const [items,setItems]=useState<Invitation[]>([]),[cursor,setCursor]=useState<string|null>(null),[url,setUrl]=useState('');
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState('');
 const generation=useRef(0);
 if(!['PLATFORM_ADMIN','ORG_ADMIN'].includes(role))return null;
 async function load(next?:string){
  const current=++generation.current;setLoading(true);setError('');
  try{
   const response=await fetch('/api/invitations'+(next?'?cursor='+encodeURIComponent(next):''),{cache:'no-store',headers:state.organizationId?{'x-workspace-id':state.organizationId}:{}});
   const result=await response.json();if(!response.ok)throw Error(result.error?.message||'Could not load invitations.');
   if(current!==generation.current)return;
   setItems(previous=>next?[...new Map([...previous,...result.data.items].map(item=>[item.id,item])).values()]:result.data.items);
   setCursor(result.data.nextCursor);setUrl(result.data.inviteUrl);
  }catch(cause){if(current===generation.current){setError(cause instanceof Error?cause.message:'Could not load invitations.');if(!next)setItems([])}}finally{if(current===generation.current)setLoading(false)}
 }
 async function revoke(item:Invitation){
  setBusy(item.id);setError('');setNotice('');
  try{
   const response=await fetch('/api/invitations/'+item.id+'/revoke',{method:'POST',headers:{'Content-Type':'application/json',...(state.organizationId?{'x-workspace-id':state.organizationId}:{})},body:'{}'});
   const result=await response.json();if(!response.ok)throw Error(result.error?.message||'Could not revoke invitation.');
   setConfirm('');await load();setNotice('Invitation revoked for '+item.email+'.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not revoke invitation.')}finally{setBusy('')}
 }
 return <><button className="um-outline" onClick={()=>{setItems([]);setCursor(null);setConfirm('');setNotice('');dialog.current?.showModal();void load()}}>Invitations</button>
  <dialog ref={dialog} className="um-dialog um-invitations" aria-labelledby="invitations-title">
   <header className="um-dialog-heading"><h2 id="invitations-title">Invitations</h2><button disabled={!!busy} onClick={()=>{generation.current++;dialog.current?.close()}}>Close</button></header>
   <p>Review approved accounts and revoke invitations that are no longer needed. Pending invitations expire after seven days.</p>
   {error&&<p role="alert" className="um-form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
   <button disabled={loading||!!busy} onClick={()=>void load()}>Refresh invitations</button>
   {loading&&<p role="status">Loading invitations…</p>}
   {!loading&&!error&&!items.length&&<p>No invitations yet. Use Invite user to add an approved Google account.</p>}
   <ul className="um-invitation-list">{items.map(item=><li key={item.id}>
    <strong>{item.email}</strong><span>{roleNames[item.role]||item.role} · {item.status.toLowerCase()}</span>
    <small>Expires {new Date(item.expires_at).toLocaleString()}</small>
    {item.status==='PENDING'&&<div className="um-invitation-actions">
     {item.linkReady&&<input aria-label={'Invitation link for '+item.email} readOnly value={url+'?invitation='+encodeURIComponent(item.id)} onFocus={event=>event.target.select()}/>}
     {item.linkReady&&<button disabled={!!busy} onClick={()=>navigator.clipboard.writeText(url+'?invitation='+encodeURIComponent(item.id)).then(()=>setNotice('Invitation link copied. Share it with '+item.email+'.')).catch(()=>setError('Copy the invitation link from the field below.'))}>Copy link</button>}
     <button disabled={!!busy} onClick={()=>setConfirm(item.id)}>Revoke invitation for {item.email}</button>
     {confirm===item.id&&<div role="group" aria-label="Confirm revocation"><p>This will prevent this pending invitation from being accepted.</p><button disabled={!!busy} onClick={()=>void revoke(item)}>{busy===item.id?'Revoking…':'Confirm revoke'}</button><button disabled={!!busy} onClick={()=>setConfirm('')}>Keep invitation</button></div>}
    </div>}
   </li>)}</ul>
   {cursor&&<button disabled={loading||!!busy} onClick={()=>void load(cursor)}>Load more invitations</button>}
  </dialog></>;
}
