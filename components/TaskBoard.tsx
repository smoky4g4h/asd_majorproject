'use client';
import {useEffect,useRef,useState} from 'react';
import {format,isSameDay,isValid} from 'date-fns';
import {Pencil,Loader,Star,Flag,MoreHorizontal,Plus,MessageSquare,CalendarDays,ListChecks,X,CheckCircle2,ArrowRight} from 'lucide-react';
import {useWorkspace} from './WorkspaceStore';
import TaskBoardTools from './TaskBoardTools';
import {can,type Task} from '../lib/domain';

type Status=NonNullable<Task['status']>;
const columns=[{status:'To-do',title:'To Do',label:'To-do',Icon:Pencil},{status:'On-going',title:'On Going',label:'On-going',Icon:Loader},{status:'On Review',title:'On Review',label:'On-review',Icon:Star}] as const;
const rank={High:0,Medium:1,Low:2};
function TaskPortraitGroup({index,count}:{index:number;count:number}){
 const groups=count>2?[[416,400,37],[416,565,37],[416,864,37]]:[[416,713,28],[756,384,28],[756,534,28]];
 const [x,y,width]=groups[index%groups.length];
 return <svg className="task-reference-portraits" width={width} height="20" style={{width,height:20}} viewBox={`${x} ${y} ${width} 20`} aria-hidden="true"><image href="/reference-assets/tasks.webp" width="1600" height="1200"/></svg>;
}
const taskStatus=(task:Task):Status=>task.done?'Done':task.status==='Done'?'To-do':task.status||'To-do';

export default function TaskBoard(){
 const {state,send}=useWorkspace();const user=state.users.find(person=>person.id===state.currentUserId)!;
 const meetings=state.meetings.filter(meeting=>can(user,'meeting:view',meeting));
 const available=meetings.filter(meeting=>meeting.state!=='CANCELLED');
 const tasks=state.tasks.filter(task=>meetings.some(meeting=>meeting.id===task.meetingId)&&(task.assignee===user.id||can(user,'task:create')));
 const [draft,setDraft]=useState<Task|null>(null),[note,setNote]=useState(''),[menu,setMenu]=useState(''),[sorted,setSorted]=useState(false),[notice,setNotice]=useState(''),[dragging,setDragging]=useState(''),[over,setOver]=useState('');
 const editor=useRef<HTMLDialogElement>(null),completed=useRef<HTMLDialogElement>(null);
 const finished=tasks.filter(task=>taskStatus(task)==='Done');
 useEffect(()=>{if(!menu)return;const close=(event:PointerEvent)=>{if(!(event.target as Element).closest('.task-menu-anchor'))setMenu('')};const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setMenu('')};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key)}},[menu]);
 function openTask(task?:Task,status:Status='To-do'){
  setMenu('');setDraft(task?{...task,checklist:task.checklist?.map(item=>({...item}))}:{id:'',title:'',description:'',priority:'Medium',status,done:false,due:new Date().toISOString(),assignee:user.id,meetingId:available[0]?.id||'',checklist:[]});
  setNote(task?state.notes['task-note-'+user.id+'-'+task.id]||'':'');editor.current?.showModal();
 }
 async function move(task:Task,status:Status){if(!await send({type:'task',task:{...task,status,done:status==='Done'}}))return;setMenu('');setNotice(`${task.title} moved to ${status==='To-do'?'To Do':status==='On-going'?'On Going':status}.`)}
 function columnTasks(status:Status){const items=tasks.filter(task=>taskStatus(task)===status);return sorted?items.sort((a,b)=>rank[a.priority||'Medium']-rank[b.priority||'Medium']||new Date(a.due).getTime()-new Date(b.due).getTime()):items}
 function renderCard(task:Task){
  const column=columns.find(column=>column.status===taskStatus(task))||columns[0],Icon=column.Icon;
  const due=new Date(task.due),today=isValid(due)&&isSameDay(due,new Date());
  const people=[...new Set([task.assignee,...(task.collaboratorIds||[])])].map(id=>state.users.find(person=>person.id===id)).filter(person=>!!person).slice(0,3);
  const checklist=task.checklist||[];
  return <article key={task.id} className="task-board-card" draggable onDragStart={event=>{event.dataTransfer.setData('text/plain',task.id);event.dataTransfer.effectAllowed='move';setDragging(task.id)}} onDragEnd={()=>{setDragging('');setOver('')}} data-dragging={dragging===task.id}>
   <div className="task-card-badges"><div className="task-menu-anchor"><button className="task-status-badge" aria-label={'Move '+task.title} aria-expanded={menu===task.id} onClick={()=>setMenu(menu===task.id?'':task.id)}><Icon/>{column.label}</button>{menu===task.id&&<div className="task-board-menu">{[...columns.map(column=>column.status),'Done' as const].filter(status=>status!==taskStatus(task)).map(status=><button key={status} onClick={()=>move(task,status)}><ArrowRight/>{status}</button>)}</div>}</div><span className={'task-priority priority-'+(task.priority||'Medium').toLowerCase()}><Flag/>{task.priority||'Medium'}</span></div>
   <button className="task-card-title" onClick={()=>openTask(task)}>{task.title}</button>
   {task.description&&<p>{task.description}</p>}
   <footer><div className="task-card-people" aria-label={'Assigned to '+people.map(person=>person.name).join(', ')}><TaskPortraitGroup index={Math.max(0,state.tasks.findIndex(item=>item.id===task.id))} count={people.length}/></div><button aria-label={'View notes for '+task.title} onClick={()=>openTask(task)}><MessageSquare/>{state.notes['task-note-'+user.id+'-'+task.id]?1:0}</button><span className={today?'task-due today':'task-due'}><CalendarDays/>{today?'Today':isValid(due)?format(due,'MMM d'):'No date'}</span><button aria-label={'View checklist for '+task.title} onClick={()=>openTask(task)}><ListChecks/>{checklist.filter(item=>item.done).length}/{checklist.length}</button></footer>
  </article>;
 }
 return <main className="task-board-layout" aria-label="My task board">
  <div className="task-board-frame"><div className="task-board-columns" tabIndex={0} aria-label="Task columns; scroll horizontally to see more">
   {columns.map(({status,title,Icon})=><section key={status} className="task-board-column" aria-label={title} data-drop-active={over===status} onDragOver={event=>{if(dragging){event.preventDefault();event.dataTransfer.dropEffect='move';setOver(status)}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOver('')}} onDrop={event=>{event.preventDefault();const task=tasks.find(task=>task.id===event.dataTransfer.getData('text/plain'));if(task)move(task,status);setDragging('');setOver('')}}>
    <header><Icon className={'task-column-icon status-'+status.toLowerCase().replaceAll(' ','-')}/><h1>{title}</h1><span className="task-column-count">{columnTasks(status).length}</span><div className="task-menu-anchor"><button className="task-column-options" aria-label={title+' options'} aria-expanded={menu===status} onClick={()=>setMenu(menu===status?'':status)}><MoreHorizontal/></button>{menu===status&&<div className="task-board-menu"><button onClick={()=>openTask(undefined,status)} disabled={!available.length}><Plus/>Add task</button><button onClick={()=>{setSorted(!sorted);setMenu('')}}>{sorted?'Original order':'Sort by priority'}</button><button onClick={()=>{setMenu('');completed.current?.showModal()}}>Completed tasks ({finished.length})</button></div>}</div></header>
    <div className="task-column-well"><button className="task-add-button" onClick={()=>openTask(undefined,status)} disabled={!available.length}><Plus/>Add New Task</button>{columnTasks(status).map(renderCard)}{!columnTasks(status).length&&<p className="task-column-empty">{available.length?'No tasks here yet. Add a task or move one into this column.':'No tasks here. Join or schedule a meeting to get started.'}</p>}</div>
   </section>)}
  </div></div>
  <TaskBoardTools add={()=>openTask()} organize={()=>{setSorted(true);setNotice('Tasks sorted by priority and due date.')}} canSchedule={can(user,'meeting:create')} disabled={!available.length}/>
  {notice&&<div className="task-board-notice" role="status">{notice}<button aria-label="Dismiss task message" onClick={()=>setNotice('')}><X/></button></div>}
  <dialog ref={editor} className="workspace-dialog task-editor" onClose={()=>setDraft(null)}>{draft&&<form onSubmit={async event=>{event.preventDefault();if(!draft.title.trim()||!meetings.some(meeting=>meeting.id===draft.meetingId))return;const task={...draft,id:draft.id||crypto.randomUUID(),title:draft.title.trim(),checklist:draft.checklist?.filter(item=>item.text.trim()),done:draft.status==='Done'};if(!await send({type:'task',task}))return;const noteKey='task-note-'+user.id+'-'+task.id;if(note!==(state.notes[noteKey]||'')&&!await send({type:'note',key:noteKey,value:note}))return;editor.current?.close()}}>
   <header><h2>{draft.id?'Edit task':'Add new task'}</h2><button type="button" aria-label="Close task form" onClick={()=>editor.current?.close()}><X/></button></header>
   <label>Task title<input name="title" autoFocus required value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
   <label>Description<textarea rows={3} value={draft.description||''} onChange={event=>setDraft({...draft,description:event.target.value})}/></label>
   <div className="workspace-form-row"><label>Status<select aria-label="Status" value={taskStatus(draft)} onChange={event=>setDraft({...draft,status:event.target.value as Status,done:event.target.value==='Done'})}><option>To-do</option><option>On-going</option><option>On Review</option><option>Done</option></select></label><label>Priority<select value={draft.priority||'Medium'} onChange={event=>setDraft({...draft,priority:event.target.value as Task['priority']})}><option>High</option><option>Medium</option><option>Low</option></select></label><label>Due date<input type="date" required value={isValid(new Date(draft.due))?format(new Date(draft.due),'yyyy-MM-dd'):''} onChange={event=>setDraft({...draft,due:event.target.value?new Date(event.target.value+'T12:00:00').toISOString():''})}/></label></div>
   <div className="workspace-form-row"><label>Meeting<select required value={draft.meetingId} onChange={event=>setDraft({...draft,meetingId:event.target.value})}>{meetings.filter(meeting=>meeting.state!=='CANCELLED'||meeting.id===draft.meetingId).map(meeting=><option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}</select></label><label>Assignee<select value={draft.assignee} onChange={event=>setDraft({...draft,assignee:event.target.value})}>{state.users.filter(person=>person.id===draft.assignee||person.active&&!person.deleted&&(can(user,'task:create')||person.id===user.id)).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div>
   <label>Checklist items<textarea rows={3} placeholder="One item per line" value={(draft.checklist||[]).map(item=>item.text).join('\n')} onChange={event=>setDraft({...draft,checklist:event.target.value.split('\n').map((text,index)=>{const prior=draft.checklist?.[index];return {id:prior?.id||crypto.randomUUID(),text,done:prior?.text===text?prior.done:false}})})}/></label>
   <div className="task-editor-checklist">{draft.checklist?.filter(item=>item.text.trim()).map(item=><label key={item.id}><input type="checkbox" checked={item.done} onChange={()=>setDraft({...draft,checklist:draft.checklist?.map(step=>step.id===item.id?{...step,done:!step.done}:step)})}/>{item.text}</label>)}</div>
   <label>Private task note<textarea rows={2} value={note} onChange={event=>setNote(event.target.value)}/></label>
   <footer><button type="button" onClick={()=>editor.current?.close()}>Cancel</button><button className="workspace-green">Save task</button></footer>
  </form>}</dialog>
  <dialog ref={completed} className="workspace-dialog task-completed"><header><h2>Completed tasks</h2><button aria-label="Close completed tasks" onClick={()=>completed.current?.close()}><X/></button></header>{finished.length?finished.map(task=><article key={task.id}><CheckCircle2/><span>{task.title}</span><button aria-label={'Reopen '+task.title} onClick={()=>move(task,'To-do')}>Reopen</button></article>):<p>No completed tasks yet.</p>}</dialog>
 </main>;
}
