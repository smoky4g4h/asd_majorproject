import nextEnv from '@next/env';
import {readFile} from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!ref||!token)throw Error('Management configuration missing');
async function query(sql){const response=await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Database request failed: HTTP '+response.status);return response.json()}
for(const [version,name] of [['20261111012000','admin_cancel_meeting'],['20261111012100','admin_cancel_cleanup']]){
const applied=(await query(`select exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as applied`))[0].applied;
if(!applied){
 const ready=(await query("select exists(select 1 from supabase_migrations.schema_migrations where version='20261109163917') and to_regprocedure('public.claim_media_operations()') is not null as ready"))[0].ready;
 if(!ready)throw Error('Expected baseline differs; inspect before applying.');
 if(process.argv.includes('--apply')){const source=await readFile(new URL('../supabase/migrations/'+version+'_'+name+'.sql',import.meta.url),'utf8');const quote=s=>"'"+s.replaceAll("'","''")+"'";await query('begin;\n'+source.trim().replace(/^begin;/i,'').replace(/commit;$/i,'')+`\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(source)}]);\ncommit;`);console.log('Admin cancellation migration applied atomically.');}
 else console.log('Read-only check: baseline compatible; admin cancellation migration pending.');
}else console.log('Admin cancellation migration already applied.');
if(applied||process.argv.includes('--apply'))console.log(JSON.stringify(await query("select has_function_privilege('anon','public.admin_cancel_meeting(uuid,uuid)','execute') anonymous_directory,has_function_privilege('authenticated','public.admin_cancel_meeting(uuid,uuid)','execute') authenticated_directory")));

}
