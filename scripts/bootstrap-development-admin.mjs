import nextEnv from '@next/env';
import {createClient} from '@supabase/supabase-js';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
if(process.env.SUPABASE_PROJECT_REF!=='mftyekqjrhwdtckskpps')throw Error('Unexpected development target.');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const email='vigneshgoud70@gmail.com',name="iconicvenom's org";
function checked(result,label){if(result.error)throw Error(`${label} failed (${result.error.code||result.error.status||'service error'})`);return result.data}
const admins=checked(await db.from('organization_members').select('user_id,organization_id').eq('role','PLATFORM_ADMIN').eq('state','ACTIVE'),'Existing administrator check');
if(admins.length){const existing=checked(await db.auth.admin.getUserById(admins[0].user_id),'Administrator identity check');if(existing.user.email!==email)throw Error('An unexpected administrator already exists.');console.log('Requested first administrator already exists.');process.exit(0)}
const users=checked(await db.auth.admin.listUsers({page:1,perPage:100}),'Identity lookup');let user=users.users.find(u=>u.email===email);
if(!user){const result=checked(await db.auth.admin.generateLink({type:'invite',email,options:{redirectTo:process.env.NEXT_PUBLIC_APP_URL+'/auth/callback?next=/auth/accept-invite'}}),'Create invitation identity');user=result.user;/* No email is sent by generateLink; discard bearer URL. Onboarding delivery follows UI integration. */}
let org=checked(await db.from('organizations').select('id').eq('name',name).maybeSingle(),'Organization lookup');
if(!org)org=checked(await db.from('organizations').insert({name}).select('id').single(),'Organization creation');
const profile=checked(await db.from('profiles').select('id').eq('id',user.id).maybeSingle(),'Profile verification');console.log('Admin profile present:',Boolean(profile));
if(!profile)checked(await db.from('profiles').insert({id:user.id,full_name:'Vignesh'}),'Bootstrap missing profile');
checked(await db.from('organization_members').insert({organization_id:org.id,user_id:user.id,role:'PLATFORM_ADMIN',state:'ACTIVE'}),'First administrator bootstrap');
checked(await db.from('audit_events').insert({organization_id:org.id,actor_id:user.id,action:'administrator.bootstrapped',resource_id:user.id,details:{method:'explicit-development-bootstrap',onboardingDelivery:'pending'}}),'Bootstrap audit');
console.log('Organization and first administrator created. MFA is required for privileged access. Onboarding email has not been sent.');
