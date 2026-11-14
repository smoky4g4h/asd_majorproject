import nextEnv from '@next/env';
import {readFile} from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!ref||!token)throw Error('Management configuration missing');
const files=['20261107150952_enforce_google_sessions.sql','20261108171848_harden_meeting_lifecycle.sql','20261109061427_media_recovery_queue.sql','20261109061549_persistent_messaging.sql'];
async function query(sql){const response=await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Database request failed: HTTP '+response.status);return response.json()}
const history=await query('select version from supabase_migrations.schema_migrations order by version');
const versions=new Set(history.map(row=>row.version));
for(const baseline of ['20261107034848','20261107034902','20261107035031'])if(!versions.has(baseline))throw Error('Expected hosted baseline missing; review migration history.');
const compatible=(await query("select to_regprocedure('public.meeting_action(uuid,text,jsonb)') is not null and to_regclass('private.media_operations') is not null and to_regclass('public.message_threads') is not null as ready"))[0]?.ready;
if(!compatible)throw Error('Required baseline schema is unavailable.');
const pending=files.filter(file=>!versions.has(file.split('_')[0]));console.log('Pending targeted migrations:',pending.join(', ')||'none');
if(process.argv.includes('--apply')&&pending.length){
 let sql='begin;\n';const quote=value=>"'"+value.replaceAll("'","''")+"'";
 for(const file of pending){const source=await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');const migration=source.trim().replace(/^begin;/i,'').replace(/commit;$/i,'');sql+=migration+'\n';const version=file.split('_')[0],name=file.slice(version.length+1,-4);sql+=`insert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(version)},${quote(name)},ARRAY[${quote(source)}]);\n`;}
 sql+='commit;';await query(sql);console.log('Targeted migrations applied atomically.');
}else console.log('Read-only check. Pass --apply to install the reviewed targeted migrations.');
