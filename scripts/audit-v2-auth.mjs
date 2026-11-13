import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const env=process.env;
if(env.SUPABASE_PROJECT_REF!=='mftyekqjrhwdtckskpps')throw Error('Unexpected development target');
const r=await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/config/auth`,{headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(20000)});
if(!r.ok)throw Error(`Auth audit HTTP ${r.status}`);
const c=await r.json();
console.log(JSON.stringify({siteUrl:c.site_url,redirectAllowlist:c.uri_allow_list,googleEnabled:c.external_google_enabled,emailEnabled:c.external_email_enabled,signupDisabled:c.disable_signup,smtpConfigured:Boolean(c.smtp_host&&c.smtp_user),jwtExpirySeconds:c.jwt_exp},null,2));
