import nextEnv from '@next/env';
import {writeFile} from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const ref=process.env.SUPABASE_PROJECT_REF;if(ref!=='mftyekqjrhwdtckskpps')throw Error('Unexpected target.');
const base=`https://api.supabase.com/v1/projects/${ref}/database/migrations`;
const name='deny_anonymous_application_rpc';
const signatures=['consume_rate_limit(text)','create_invitation(uuid,text,public.app_role)','accept_invitation()','manage_member(uuid,uuid,public.app_role,boolean)','revoke_invitation(uuid)','update_profile(text)','workspace_mutate(uuid,jsonb)','meeting_action(uuid,text,jsonb)','complete_media_operation(uuid)'];
const query='-- Hosted Supabase default ACLs include explicit anon grants.\n'+signatures.map(s=>`revoke execute on function public.${s} from public, anon;`).join('\n')+'\n';
async function call(method,value){const r=await fetch(base,{method,headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:value?JSON.stringify(value):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Migration endpoint HTTP ${r.status}`);return r.json()}
let history=await call('GET');if(!history.some(m=>m.name===name)){await call('POST',{name,query});history=await call('GET')}
const migration=history.find(m=>m.name===name);if(!migration?.version)throw Error('Migration history unavailable.');await writeFile(`supabase/migrations/${migration.version}_${name}.sql`,query);console.log('Anonymous RPC grants revoked; generated migration version saved locally.');
