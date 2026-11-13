'use client';
import {usePathname,useRouter} from 'next/navigation';
import AuthScreen from './AuthScreen';
import {memo,useEffect,useState} from 'react';
import ProductRail from './ProductRail';
import WorkspaceHeader from './WorkspaceHeader';
import ReferenceCalendar from './ReferenceCalendar';
import Workspace from './Workspace';
import {WorkspaceProvider,useWorkspace} from './WorkspaceStore';
const PersistentCalendar=memo(ReferenceCalendar);
export default function ProductShell({children}:{children:React.ReactNode}){return <WorkspaceProvider><Shell>{children}</Shell></WorkspaceProvider>}
function Shell({children}:{children:React.ReactNode}){
 const path=usePathname(),router=useRouter();const {state,ready,error,authCode,refresh,setError}=useWorkspace();const [open,setOpen]=useState(false);const [collapsed,setCollapsed]=useState(false);
 useEffect(()=>{try{setCollapsed(localStorage.getItem('securemeet-sidebar-collapsed')==='true')}catch{}},[]);
 function toggleSidebar(){const next=!collapsed;setCollapsed(next);try{localStorage.setItem('securemeet-sidebar-collapsed',String(next))}catch{}}
const calendar=path==='/calendar';
 const [calendarVisited,setCalendarVisited]=useState(calendar);
 useEffect(()=>{if(calendar)setCalendarVisited(true)},[calendar]);
 useEffect(()=>setOpen(false),[path]);useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);
 if(!ready)return <div className="loading" role="status">Checking your workspace access…</div>;
 if(!state.currentUserId||path==='/login'||path.startsWith('/auth/'))return <AuthScreen setup={authCode==='SETUP_REQUIRED'} reason={error} onAuthenticated={async()=>{await refresh();router.replace('/dashboard')}}/>;
 return <div className="product-shell new-workspace-shell" data-sidebar-collapsed={collapsed}><WorkspaceHeader openNavigation={()=>setOpen(true)} collapsed={collapsed} toggleSidebar={toggleSidebar}/><ProductRail active={path==='/'?'dashboard':path.split('/')[1]} open={open} close={()=>setOpen(false)}/>{open&&<button className="workspace-nav-scrim" aria-label="Close navigation" onClick={()=>setOpen(false)}/>}<div className="shell-content">{error&&<div role="alert" className="error">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}{(calendar||calendarVisited)&&<div hidden={!calendar} className="calendar-surface"><PersistentCalendar key={state.currentUserId+":"+state.organizationId}/></div>}<div hidden={calendar} className="workspace-surface"><Workspace key={state.currentUserId+":"+state.organizationId}/></div>{children}</div></div>;
}
