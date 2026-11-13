import nextEnv from '@next/env';
import {writeFile} from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const ref=process.env.SUPABASE_PROJECT_REF;
const query=`select p.proname as name,has_function_privilege('anon',p.oid,'execute') as anon_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('consume_rate_limit','create_invitation','accept_invitation','manage_member','revoke_invitation','update_profile','workspace_mutate','meeting_action','complete_media_operation')`;
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Policy query HTTP ${r.status}`);const grants=await r.json();console.log(JSON.stringify(grants));await writeFile('artifacts/hosted-function-grants.json',JSON.stringify(grants,null,2));
