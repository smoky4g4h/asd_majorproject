import nextEnv from '@next/env';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const env=process.env;
if(env.SUPABASE_PROJECT_REF!=='mftyekqjrhwdtckskpps')throw Error('Unexpected development target');
const require=createRequire(import.meta.url);
function fixture(name){const exports={};const code=ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','exports',code)(name=>name==='./reference-tasks'?fixture('reference-tasks'):require(name),exports);return exports;}
const data=fixture('domain').seed(new Date());
const q=value=>value==null?'null':"'"+String(value).replaceAll("'","''")+"'";
const uid=key=>{const h=createHash('sha256').update('securemeet-showcase-v1:'+key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
async function query(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Showcase database request HTTP ${r.status}`);return r.json()}
const targets=await query("select m.organization_id,m.user_id from public.organization_members m join auth.users u on u.id=m.user_id where lower(u.email)='vigneshgoud70@gmail.com' and m.role='PLATFORM_ADMIN' and m.state='ACTIVE'");
if(targets.length!==1)throw Error('Expected exactly one active Vignesh administrator');
const {organization_id:org,user_id:user}=targets[0];
const before=await query('select count(*)::int as count from public.profiles');
const statements=['begin'];
function insert(table,row){statements.push(`insert into public.${table} (${Object.keys(row).join(',')}) values (${Object.values(row).map(q).join(',')}) on conflict do nothing`)}
for(const m of data.meetings){insert('meetings',{id:uid(m.id),organization_id:org,organizer_id:user,title:m.title,description:m.description+' Sample meeting for demonstration.',agenda:JSON.stringify(m.agenda),starts_at:m.startAt,ends_at:m.endAt,timezone:'Asia/Kolkata',status:'SCHEDULED'});insert('meeting_members',{meeting_id:uid(m.id),organization_id:org,user_id:user,meeting_role:'HOST',invitation_status:'ACCEPTED'});insert('notifications',{id:uid('notice:'+m.id),organization_id:org,user_id:user,body:`Sample meeting: ${m.title}`,target:`/meetings/${uid(m.id)}`})}
for(const t of data.tasks){insert('tasks',{id:uid(t.id),organization_id:org,meeting_id:uid(t.meetingId),creator_id:user,title:t.title,description:t.description,status:t.status,priority:t.priority,due_at:t.due?new Date(t.due).toISOString():null});insert('task_assignees',{task_id:uid(t.id),organization_id:org,user_id:user});for(const [i,c] of (t.checklist||[]).entries())insert('task_checklist_items',{id:uid(t.id+':check:'+i),task_id:uid(t.id),body:c.text,done:c.done,position:i})}
for(const d of data.documents){insert('folders',{id:uid('folder:'+d.folder),organization_id:org,owner_id:user,name:d.folder});insert('documents',{id:uid(d.id),organization_id:org,owner_id:user,meeting_id:uid(d.meetingId),folder_id:uid('folder:'+d.folder),name:d.name,body:d.content,size:d.size,kind:d.kind||'document',created_at:d.createdAt});if(d.favorite)insert('favorites',{document_id:uid(d.id),user_id:user})}
insert('notes',{id:uid('showcase-note'),organization_id:org,author_id:user,title:'Showcase preparation',body:'Review the committee briefing, walk through the Kanban board, and open the upcoming academic review. Sample content is for demonstration.'});
statements.push('commit');
await query(statements.join(';\n'));
const counts=await query(`select (select count(*) from public.meetings where id in (${data.meetings.map(m=>q(uid(m.id))).join(',')}))::int meetings,(select count(*) from public.tasks where id in (${data.tasks.map(t=>q(uid(t.id))).join(',')}))::int tasks,(select count(*) from public.documents where id in (${data.documents.map(d=>q(uid(d.id))).join(',')}))::int documents,(select count(*) from public.profiles)::int profiles`);
if(counts[0].profiles!==before[0].count)throw Error('User count changed during import; investigate concurrent activity');
console.log(JSON.stringify({restored:counts[0],newUsers:0,owner:'Vignesh',existingRecordsPreserved:true}));
