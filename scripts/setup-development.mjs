import nextEnv from '@next/env';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const env=process.env,ref=env.SUPABASE_PROJECT_REF;
if(ref!=='mftyekqjrhwdtckskpps')throw Error('This setup is approved only for the confirmed development project.');
const base=`https://api.supabase.com/v1/projects/${ref}`;
async function api(path,method='GET',value){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:value?JSON.stringify(value):undefined,signal:AbortSignal.timeout(60000)});if(!r.ok){const result=await r.json().catch(()=>({}));const code=result.code||result.error_code||'';throw Error(`${method} ${path}: HTTP ${r.status} ${code}`)}return r.json()}
const project=await api('');if(project.name!=='AICTE_Secure_Meet')throw Error('Project name does not match the user-approved target.');console.log('Confirmed development project name and reference.');
const history=await api('/database/migrations');
const report={checkedAt:new Date().toISOString(),migrations:[],authConfigured:false};
const files=['202611070001_core.sql','202611070002_operations.sql'];
for(const file of files){const name=file.replace('.sql','');if(history.some(row=>row.name===name)){console.log(`${file}: already recorded`);report.migrations.push({file,status:'already applied'});continue}if(file===files[0]){const tables=await api('/database/query','POST',{query:"select tablename from pg_tables where schemaname='public'"});if(tables.length)throw Error('Public tables already exist; refusing initial setup without reviewing them.');}
 await api('/database/migrations','POST',{name,query:await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')});console.log(`${file}: applied`);report.migrations.push({file,status:'applied'});
}
const origin=env.NEXT_PUBLIC_APP_URL;
await api('/config/auth','PATCH',{site_url:origin,uri_allow_list:`${origin}/auth/callback,${origin}/auth/callback?next=/auth/accept-invite,${origin}/auth/callback?next=/auth/reset-password`,disable_signup:true,external_anonymous_users_enabled:false,mailer_autoconfirm:false,jwt_exp:900,password_min_length:12});
const auth=await api('/config/auth');report.authConfigured=auth.disable_signup===true&&auth.external_anonymous_users_enabled===false;
report.smtpConfigured=Boolean(auth.smtp_host);console.log(`Invite-only Auth verified: ${report.authConfigured}; custom SMTP configured: ${report.smtpConfigured}`);
const tables=await api('/database/query','POST',{query:"select c.relname as name,c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname"});report.tables=tables;console.log(`Public tables: ${tables.length}; RLS enabled on every table: ${tables.every(t=>t.rls)}`);
report.remoteHistory=await api('/database/migrations');
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/development-setup.json',JSON.stringify(report,null,2));
