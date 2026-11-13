'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {State,Action} from '../lib/domain';
import {browserClient} from '../lib/supabase/client';
import type {AuthChangeEvent,Session} from '@supabase/supabase-js';
import {reconcileWorkspace} from '../lib/workspace/reconcile';
const empty=():State=>({currentUserId:null,users:[],meetings:[],documents:[],tasks:[],notifications:[],notes:{}});
type OrganizationChange={action:"switch";organizationId:string}|{action:"create";name:string;icon:string};
type Store={changeOrganization:(input:OrganizationChange)=>Promise<boolean>;state:State;ready:boolean;error:string;authCode:string;pending:boolean;setError:(error:string)=>void;refresh:(fresh?:boolean)=>Promise<void>;send:(action:Action)=>Promise<boolean>};
const Context=createContext<Store|null>(null);
export function WorkspaceProvider({children}:{children:React.ReactNode}){
 const [state,setState]=useState<State>(empty),[ready,setReady]=useState(false),[error,setError]=useState(''),[authCode,setAuthCode]=useState(''),[pending,setPending]=useState(false);
 const organizationRef=useRef<string|undefined>(undefined),switching=useRef(false);
 const generation=useRef(0),sessionGeneration=useRef(0),queue=useRef(Promise.resolve(true));
 const mounted=useRef(false),lastChecked=useRef(0),identity=useRef<string|null|undefined>(undefined);
 const inFlight=useRef<{generation:number;promise:Promise<void>}|null>(null);
 const load=useCallback((fresh=false):Promise<void>=>{
  if(!fresh&&inFlight.current)return inFlight.current.promise;
  const request=++generation.current;
  const current=()=>mounted.current&&request===generation.current;
  const promise=(async()=>{
   try{
    const response=await fetch('/api/workspace',{cache:'no-store',credentials:'same-origin',headers:organizationRef.current?{'x-workspace-id':organizationRef.current}:{}});
    const result=await response.json();
    if(!current())return;
    if(!response.ok||result.error){setState(empty());setAuthCode(result.error?.code||'UNAVAILABLE');setError(result.error?.message||'Workspace unavailable.');return;}
    organizationRef.current=result.data.organizationId;setState(previous=>reconcileWorkspace(previous,result.data));setAuthCode('');setError('');
   }catch{
    if(current()){setState(empty());setAuthCode('UNAVAILABLE');setError('Cannot reach the workspace. Check your connection and retry.');}
   }finally{
    if(current()){lastChecked.current=Date.now();setReady(true);}
    if(inFlight.current?.generation===request)inFlight.current=null;
   }
  })();
  inFlight.current={generation:request,promise};
  return promise;
 },[]);
 const refresh=useCallback((fresh=false)=>load(fresh),[load]);
 useEffect(()=>{
  mounted.current=true;
  void refresh();
  const refreshIfStale=()=>{if(!switching.current&&document.visibilityState==='visible'&&Date.now()-lastChecked.current>=30_000)void refresh();};
  const interval=setInterval(refreshIfStale,30_000);
  document.addEventListener('visibilitychange',refreshIfStale);
  let unsubscribe=()=>{};
  const timers=new Set<ReturnType<typeof setTimeout>>();
  try{
   const {data}=browserClient().auth.onAuthStateChange((event:AuthChangeEvent,session:Session|null)=>{
    const userId=session?.user.id??null;
    // The initial server snapshot checks authentication; repeated SIGNED_IN
    // notifications on tab focus do not require another full workspace read.
    if(event==='INITIAL_SESSION'){identity.current=userId;return;}
    if(event==='SIGNED_IN'&&identity.current===userId){refreshIfStale();return;}
    if(event==='SIGNED_OUT'||identity.current!==userId){
     identity.current=userId;organizationRef.current=undefined;sessionGeneration.current++;generation.current++;inFlight.current=null;
     setState(empty());setPending(false);setError('');setAuthCode(event==='SIGNED_OUT'?'UNAUTHENTICATED':'');setReady(event==='SIGNED_OUT');
    }
    if(event==='SIGNED_OUT')return;
    // Keep network work outside Supabase's synchronous auth callback.
    const timer=setTimeout(()=>{timers.delete(timer);if(event==='TOKEN_REFRESHED')refreshIfStale();else void load(true);},0);
    timers.add(timer);
   });
   unsubscribe=()=>data.subscription.unsubscribe();
  }catch{/* The initial read reports missing configuration. */}
  return()=>{
   mounted.current=false;sessionGeneration.current++;
   clearInterval(interval);document.removeEventListener('visibilitychange',refreshIfStale);
   timers.forEach(clearTimeout);unsubscribe();
   // Reuse an in-flight initial read during React Strict Mode's effect replay.
  };
 },[refresh,load]);
 const send=useCallback((action:Action):Promise<boolean>=>{
  if(switching.current)return Promise.resolve(false);
  const session=sessionGeneration.current;
  const current=()=>mounted.current&&session===sessionGeneration.current;
  const operation=async()=>{if(!current())return false;setPending(true);try{
  if(action.type==='identity'||action.type==='reset')throw Error('Use Google sign-in and account settings to manage your session.');
  if(action.type==='user')throw Error('Use the invitation and membership administration flow to change users.');
  const response=await fetch('/api/workspace',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(organizationRef.current?{'x-workspace-id':organizationRef.current}:{})},body:JSON.stringify(action)});const result=await response.json();
  if(!current())return false;
  if(!response.ok||result.error)throw Error(result.error?.message||'The change could not be saved.');
  // A poll started before this write cannot supply its resulting snapshot.
  await load(true);return current();
 }catch(cause){if(current())setError(cause instanceof Error?cause.message:'The change could not be saved.');return false}finally{if(current())setPending(false)}};
 queue.current=queue.current.then(operation,operation);return queue.current;
 },[load]);
 const changeOrganization=useCallback(async(input:OrganizationChange)=>{
  if(switching.current)return false;
  switching.current=true;setPending(true);
  // Drain queued writes in their original workspace before changing the cookie.
  await queue.current;setPending(true);
  generation.current++;sessionGeneration.current++;inFlight.current=null;
  try{
   const response=await fetch('/api/organizations',{method:'POST',headers:{'Content-Type':'application/json',...(organizationRef.current?{'x-workspace-id':organizationRef.current}:{})},body:JSON.stringify(input)});
   const result=await response.json();if(!response.ok)throw Error(result.error?.message||'Cannot switch organization.');
   organizationRef.current=result.data.organizationId;
   setState(empty());setReady(false);
   await load(true);return true;
  }catch(error){setError(error instanceof Error?error.message:'Cannot switch organization.');return false}
  finally{switching.current=false;setPending(false)}
 },[load]);
 const value=useMemo(()=>({state,ready,error,authCode,pending,setError,refresh,send,changeOrganization}),[state,ready,error,authCode,pending,refresh,send,changeOrganization]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWorkspace(){const value=useContext(Context);if(!value)throw Error('WorkspaceProvider is required');return value}
