import nextEnv from '@next/env';
import {readFile} from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!ref||!token)throw Error('Management configuration missing');
async function query(sql){const response=await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Database request failed: HTTP '+response.status);return response.json()}
const version='20261109163917',name='organization_workspaces';
const applied=(await query(`select exists(select 1 from supabase_migrations.schema_migrations where version='${version}') as applied`))[0].applied;
if(!applied){
 const ready=(await query("select to_regclass('auth.mfa_factors') is not null and to_regprocedure('public.workspace_mutate(uuid,jsonb)') is not null and exists(select 1 from pg_constraint where conrelid='public.notes'::regclass and conname='notes_author_id_title_key') as ready"))[0].ready;
 if(!ready)throw Error('Expected baseline differs; inspect before applying.');
 if(process.argv.includes('--apply')){const source=await readFile(new URL('../supabase/migrations/'+version+'_'+name+'.sql',import.meta.url),'utf8');const quote=s=>"'"+s.replaceAll("'","''")+"'";await query('begin;\n'+source.trim().replace(/^begin;/i,'').replace(/commit;$/i,'')+`\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${quote(source)}]);\ncommit;`);console.log('Organization migration applied atomically.');}
 else console.log('Read-only check: baseline compatible; organization migration pending.');
}else console.log('Organization migration already applied.');
if(applied||process.argv.includes('--apply'))console.log(JSON.stringify(await query("select (select count(*) from public.organizations) organization_count, (select count(*) from public.organization_members where role in ('PLATFORM_ADMIN','ORG_ADMIN') and state='ACTIVE') admin_memberships,has_function_privilege('anon','public.workspace_directory(uuid)','execute') anon_directory,has_function_privilege('authenticated','public.workspace_directory(uuid)','execute') member_directory,has_table_privilege('authenticated','auth.users','select') direct_auth_read")));
