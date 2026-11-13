import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const env=process.env;if(env.SUPABASE_PROJECT_REF!=='mftyekqjrhwdtckskpps')throw Error('Unexpected development target.');
const url=`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/config/auth`;
const headers={Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'};
async function call(method,value){const r=await fetch(url,{method,headers,body:value?JSON.stringify(value):undefined,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Auth configuration HTTP ${r.status}`);return r.json()}
const current=await call('GET');
console.log(`Google enabled: ${Boolean(current.external_google_enabled)}; Google client configured: ${Boolean(current.external_google_client_id&&current.external_google_secret)}`);
if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET){console.log('Google OAuth activation pending: configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET privately in .env.local. No provider settings changed.');process.exit(0)}
if(!env.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com'))throw Error('Expected a Google Web application client ID.');
await call('PATCH',{external_google_enabled:true,external_google_client_id:env.GOOGLE_CLIENT_ID,external_google_secret:env.GOOGLE_CLIENT_SECRET,external_email_enabled:false,external_phone_enabled:false,external_anonymous_users_enabled:false,disable_signup:true,site_url:env.NEXT_PUBLIC_APP_URL,uri_allow_list:env.NEXT_PUBLIC_APP_URL+'/auth/callback?next=/auth/accept-invite,'+env.NEXT_PUBLIC_APP_URL+'/auth/callback?next=/dashboard'});
const verified=await call('GET');if(!verified.external_google_enabled||verified.external_email_enabled||!verified.disable_signup)throw Error('Google-only configuration verification failed.');console.log('Verified Google enabled; email/password and public signup disabled.');
