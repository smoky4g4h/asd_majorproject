import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!ref||!token)throw Error('Management configuration missing');
const query=`select version from supabase_migrations.schema_migrations order by version;`;
const response=await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});
console.log('Migration inspection HTTP',response.status);
if(response.ok){const rows=await response.json();console.log(JSON.stringify(rows.map(row=>({version:row.version}))));}else process.exitCode=1;
if(response.ok){
 const checks=`select
 has_function_privilege('authenticated','public.send_message(uuid,uuid,text)','execute') as authenticated_send,
 not has_function_privilege('anon','public.send_message(uuid,uuid,text)','execute') as anonymous_send_denied,
 not has_function_privilege('authenticated','public.claim_media_operations()','execute') as member_worker_denied,
 has_function_privilege('service_role','public.claim_media_operations()','execute') as service_worker_allowed,
 (select bool_and(relrowsecurity) from pg_class where oid in ('public.messages'::regclass,'public.message_threads'::regclass,'public.thread_members'::regclass)) as chat_rls_enabled`;
 const checked=await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:checks}),signal:AbortSignal.timeout(20000)});
 console.log('Privilege inspection HTTP',checked.status);
 if(checked.ok){const rows=await checked.json();console.log(JSON.stringify(rows));if(!Object.values(rows[0]||{}).every(value=>value===true))process.exitCode=1}else process.exitCode=1;
}
