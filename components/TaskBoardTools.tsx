'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {Plus,CalendarPlus,FilePlus2,Timer,StickyNote,MessageSquarePlus,Bot,Scan,Settings2,X,Play,Pause,RotateCcw} from 'lucide-react';

export default function TaskBoardTools({add,organize,canSchedule,disabled}:{add:()=>void;organize:()=>void;canSchedule:boolean;disabled:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [seconds,setSeconds]=useState(25*60),[running,setRunning]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!running)return;const timer=window.setInterval(()=>setSeconds(value=>{if(value<=1){setRunning(false);return 0}return value-1}),1000);return()=>clearInterval(timer)},[running]);
 return <><aside className="overview-action-rail task-action-rail" aria-label="Task quick actions">
  <button className="workspace-green" aria-label="Add task" title="Add task" onClick={add} disabled={disabled}><Plus/></button>
  <Link href={canSchedule?'/meetings/new':'/calendar'} aria-label="Schedule a meeting" title="Schedule a meeting"><CalendarPlus/></Link>
  <Link href="/documents?create=document" aria-label="Create a document" title="Create a document"><FilePlus2/></Link>
  <button aria-label="Focus timer" title="Focus timer" onClick={()=>dialog.current?.showModal()}><Timer/></button>
  <Link href="/documents?create=note" aria-label="Create a quick note" title="Create a quick note"><StickyNote/></Link>
  <Link href="/notifications" aria-label="Meeting updates" title="Meeting updates"><MessageSquarePlus/></Link>
  <button aria-label="Organize tasks by priority" title="Organize tasks by priority" onClick={organize}><Bot/></button>
  <div/>
  <button aria-label="Toggle fullscreen" title="Toggle fullscreen" onClick={async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{setError('Fullscreen is unavailable in this browser.')}}}><Scan/></button>
  <Link href="/settings" aria-label="Task preferences" title="Task preferences"><Settings2/></Link>
 </aside>
 {error&&<p role="status" className="overview-toast">{error}<button aria-label="Dismiss message" onClick={()=>setError('')}><X size={14}/></button></p>}
 <dialog ref={dialog} className="workspace-dialog"><header><h2>Focus timer</h2><button aria-label="Close focus timer" onClick={()=>dialog.current?.close()}><X/></button></header><div className="overview-timer"><strong aria-live="off">{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</strong><p>{seconds===0?'Focus session complete.':running?'Focus session in progress.':'Make room for focused work.'}</p><div><button onClick={()=>setRunning(!running)} disabled={seconds===0}>{running?<Pause/>:<Play/>}{running?'Pause':'Start focus'}</button><button onClick={()=>{setRunning(false);setSeconds(25*60)}}><RotateCcw/>Reset</button></div></div></dialog></>;
}
