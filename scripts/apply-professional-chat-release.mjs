import nextEnv from '@next/env';
import {readFile} from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!ref||!token)throw Error('Management configuration missing');
async function query(sql){const response=await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Database request failed: HTTP '+response.status);return response.json()}
const version='20261110030444',name='professional_meeting_chat';
const applied=(await query(`select exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as applied`))[0].applied;
if(!applied){
 const ready=(await query("select exists(select 1 from supabase_migrations.schema_migrations where version='20261109163917') and to_regprocedure('public.claim_media_operations()') is not null as ready"))[0].ready;
 if(!ready)throw Error('Expected baseline differs; inspect before applying.');
 if(process.argv.includes('--apply')){const source=await readFile(new URL('../supabase/migrations/'+version+'_'+name+'.sql',import.meta.url),'utf8');const quote=s=>"'"+s.replaceAll("'","''")+"'";await query('begin;\n'+source.trim().replace(/^begin;/i,'').replace(/commit;$/i,'')+`\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(source)}]);\ncommit;`);console.log('Meeting/chat migration applied atomically.');}
 else console.log('Read-only check: baseline compatible; meeting/chat migration pending.');
}else console.log('Meeting/chat migration already applied.');
if(applied||process.argv.includes('--apply'))console.log(JSON.stringify(await query("select to_regprocedure('public.deliver_scheduled_messages()') is not null delivery_function,has_function_privilege('anon','public.deliver_scheduled_messages()','execute') anon_delivery,has_function_privilege('authenticated','public.deliver_scheduled_messages()','execute') member_delivery,exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') realtime_messages")));
