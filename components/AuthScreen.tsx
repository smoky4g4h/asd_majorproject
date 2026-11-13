'use client';

import {useEffect,useId,useState,type FormEvent} from 'react';
import {usePathname} from 'next/navigation';
import {ArrowRight,LockKeyhole,LogOut,ShieldCheck} from 'lucide-react';
import {browserClient} from '../lib/supabase/client';

type Refresh=()=>Promise<void>|void;
type Props={onAuthenticated:Refresh;reason?:string;setup?:boolean};
type Factor={id:string;friendly_name?:string;status:string;factor_type:string};
type Enrollment={id:string;qr:string;secret:string};

function messageOf(error:unknown){return error instanceof Error?error.message:'The request could not be completed. Please try again.'}
// Provider QR SVG is isolated in an image, never inserted into the document as markup.
export function authenticatorQrSource(value:string){return /^data:image\/svg\+xml[;,]/i.test(value)?value:''}

function Feedback({error,notice}:{error:string;notice:string}){
 return <>{error&&<p className="auth-feedback auth-error" role="alert">{error}</p>}{notice&&<p className="auth-feedback auth-notice" role="status">{notice}</p>}</>;
}

export default function AuthScreen({onAuthenticated,reason='',setup=false}:Props){
 const path=usePathname(),invite=path==='/auth/accept-invite';
 const [signedIn,setSignedIn]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(setup)return;let active=true;void browserClient().auth.getUser().then(({data}:{data:{user:{email?:string}|null}})=>{if(active)setSignedIn(data.user?.email??null)}).catch(()=>{});return()=>{active=false}},[setup]);
 async function google(){setBusy(true);setError('');try{
  const redirect=new URL('/auth/callback',window.location.origin);redirect.searchParams.set('next',invite?'/auth/accept-invite'+window.location.search:'/dashboard');
  const {error:authError}=await browserClient().auth.signInWithOAuth({provider:'google',options:{redirectTo:redirect.toString(),queryParams:{prompt:'select_account'}}});if(authError)throw authError;
 }catch(cause){setError(messageOf(cause));setBusy(false)}}
 async function continueAccess(){setBusy(true);setError('');try{
  if(invite){const response=await fetch('/api/auth/accept-invite',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationId:new URLSearchParams(window.location.search).get('invitation')||undefined})});const result=await response.json();if(!response.ok)throw Error(result.error?.message||'Invitation could not be accepted.');}
  await onAuthenticated();
 }catch(cause){setError(messageOf(cause))}finally{setBusy(false)}}
 return <main className="auth-screen"><section className="auth-card" aria-labelledby="auth-title">
  <div className="auth-brand"><LockKeyhole size={21} aria-hidden="true"/>SecureMeet</div>
  <h1 id="auth-title">{setup?'Workspace setup required':invite?'Accept your invitation':'Sign in'}</h1>
  <p>{setup?'Account services are not configured for this workspace yet.':'Use the Google account approved by your workspace administrator.'}</p>
  {reason&&<p className="auth-feedback" role="status">{reason}</p>}
  <Feedback error={error} notice=""/>
  {!setup&&<><button className="auth-primary" disabled={busy} onClick={()=>void google()}>{busy?'Please wait…':'Continue with Google'}<ArrowRight size={16}/></button>
   {signedIn&&<><p className="auth-secondary">Signed in as {signedIn}. Workspace access requires an active invitation or membership.</p><button disabled={busy} onClick={()=>void continueAccess()}>{invite?'Accept invitation':'Continue to workspace'}</button><AccountSecurity onAuthenticated={continueAccess}/></>}
  </>}
  <p className="auth-footnote">Invitation-only access. Contact your administrator if you need an account.</p>
 </section></main>;
}

export function AccountSecurity({onAuthenticated}:{onAuthenticated?:Refresh}){
 const [factors,setFactors]=useState<Factor[]>([]),[aal,setAal]=useState<string|null>(null),[enrollment,setEnrollment]=useState<Enrollment|null>(null);
 const [selected,setSelected]=useState(''),[code,setCode]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[removeId,setRemoveId]=useState<string|null>(null);
 const field=useId();

 async function load(){
  const auth=browserClient().auth;
  const [list,assurance]=await Promise.all([auth.mfa.listFactors(),auth.mfa.getAuthenticatorAssuranceLevel()]);
  if(list.error)throw list.error;if(assurance.error)throw assurance.error;
  const totp=(list.data.all as Factor[]).filter(factor=>factor.factor_type==='totp');
  setFactors(totp);setAal(assurance.data.currentLevel);
  setSelected(current=>totp.some(factor=>factor.id===current&&factor.status==='verified')?current:totp.find(factor=>factor.status==='verified')?.id||'');
 }
 useEffect(()=>{
  let active=true;
  async function initial(){try{await load()}catch(cause){if(active)setError(messageOf(cause))}finally{if(active)setLoading(false)}}
  void initial();return()=>{active=false};
 },[]);

 async function run(operation:()=>Promise<void>){
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{await operation()}catch(cause){setError(messageOf(cause))}finally{setBusy(false)}
 }
 function enroll(){void run(async()=>{
  const {data,error:authError}=await browserClient().auth.mfa.enroll({factorType:'totp',friendlyName:`Authenticator ${new Date().toLocaleString()}`});
  if(authError)throw authError;
  setEnrollment({id:data.id,qr:authenticatorQrSource(data.totp.qr_code),secret:data.totp.secret});setCode('');
  await load();
 })}
 function verify(event:FormEvent){event.preventDefault();void run(async()=>{
  const factorId=enrollment?.id||selected;if(!factorId)throw new Error('Select an authenticator first.');
  if(!/^\d{6}$/.test(code))throw new Error('Enter the six-digit code from your authenticator.');
  const {error:authError}=await browserClient().auth.mfa.challengeAndVerify({factorId,code});if(authError)throw authError;
  setCode('');setEnrollment(null);await load();setNotice('Authenticator verified for this session.');await onAuthenticated?.();
 })}
 function remove(factorId:string){void run(async()=>{
  const auth=browserClient().auth;
  const factor=factors.find(item=>item.id===factorId);
  if(factor?.status==='verified'){
   const assurance=await auth.mfa.getAuthenticatorAssuranceLevel();if(assurance.error)throw assurance.error;
   if(assurance.data.currentLevel!=='aal2')throw new Error('Verify your authenticator code before removing a verified factor.');
  }
  // Supabase Auth independently enforces AAL2 for verified-factor removal.
  const {error:authError}=await auth.mfa.unenroll({factorId});if(authError)throw authError;
  if(enrollment?.id===factorId){setEnrollment(null);setCode('')}
  setRemoveId(null);await load();setNotice('Authenticator removed. Privileged actions still require a verified authenticator.');
 })}
 function logout(){void run(async()=>{
  const {error:authError}=await browserClient().auth.signOut({scope:'local'});if(authError)throw authError;
  window.location.assign('/login');
 })}
 const verified=factors.filter(factor=>factor.status==='verified');
 return <section className="account-security" aria-labelledby={`${field}-title`} aria-busy={loading||busy}>
  <header><ShieldCheck size={19} aria-hidden="true"/><h2 id={`${field}-title`}>Account security</h2></header>
  <Feedback error={error} notice={notice}/>
  {loading?<p role="status" className="auth-secondary">Checking authenticators…</p>:<>
   <p className="auth-secondary">{aal==='aal2'?'This session has completed two-factor verification.':verified.length?'Verify an authenticator code to complete two-factor verification for this session.':'Add an authenticator to protect your account. Administrators and organizers need it for privileged actions.'}</p>
   {factors.length>0&&<ul className="auth-factors">{factors.map(factor=><li key={factor.id}>
    <div><strong>{factor.friendly_name||'Authenticator'}</strong><span>{factor.status==='verified'?'Verified authenticator':'Setup incomplete'}</span></div>
    <button type="button" className="auth-text-button" disabled={busy} onClick={()=>setRemoveId(factor.id)} aria-label={`Remove ${factor.friendly_name||'authenticator'}`}>Remove</button>
   </li>)}</ul>}
   {removeId&&<div className="auth-confirm"><p>Remove this authenticator? You may need to enroll and verify another before using privileged actions.</p><div className="auth-actions"><button type="button" disabled={busy} onClick={()=>remove(removeId)}>Remove authenticator</button><button type="button" disabled={busy} onClick={()=>setRemoveId(null)}>Keep authenticator</button></div></div>}
   {enrollment&&<div className="auth-enrollment">
    <p>Scan this code with your authenticator app, then enter its six-digit code below.</p>
    {enrollment.qr&&<img src={enrollment.qr} alt="QR code for setting up your SecureMeet authenticator" width={192} height={192}/>}
    <details><summary>Enter the setup key manually</summary><code>{enrollment.secret}</code><p className="auth-secondary">Keep this key private. It will disappear after verification.</p></details>
   </div>}
   {(enrollment||verified.length>0)&&<form className="auth-form" onSubmit={verify}>
    <fieldset disabled={busy}>
     {!enrollment&&verified.length>1&&<label htmlFor={`${field}-factor`}>Authenticator<select id={`${field}-factor`} value={selected} onChange={event=>setSelected(event.target.value)}>{verified.map(factor=><option key={factor.id} value={factor.id}>{factor.friendly_name||'Authenticator'}</option>)}</select></label>}
     <label htmlFor={`${field}-code`}>Authenticator code<input id={`${field}-code`} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))}/></label>
     <button className="auth-primary" type="submit">{busy?'Verifying…':'Verify authenticator'}</button>
    </fieldset>
   </form>}
   {!enrollment&&<button type="button" disabled={busy} onClick={enroll}>Add authenticator</button>}
   {error&&<button type="button" className="auth-text-button" disabled={busy} onClick={()=>void run(load)}>Refresh security status</button>}
  </>}
  <div className="auth-security-footer"><button type="button" disabled={busy} onClick={logout}><LogOut size={16} aria-hidden="true"/>Sign out of this browser</button></div>
 </section>;
}
