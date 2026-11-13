import nextEnv from '@next/env';
import {RoomServiceClient} from 'livekit-server-sdk';
nextEnv.loadEnvConfig(process.cwd(),true, {info(){},error(){}});
const env=process.env;
// Credentials are sent only to the configured service endpoints. Never print response bodies.
async function check(label,url,headers){
 try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});console.log(`${label}: HTTP ${r.status}`);return r}
 catch{console.log(`${label}: CONNECTION_FAILED`);return null}
}
const url=env.NEXT_PUBLIC_SUPABASE_URL;
if(!url||new URL(url).protocol!=='https:')throw Error('Configure a valid HTTPS Supabase URL.');
await check('Supabase public Auth',`${url}/auth/v1/settings`,{apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY});
await check('Supabase Auth administration',`${url}/auth/v1/admin/users?page=1&per_page=1`,{apikey:env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY}`});
const project=await check('Supabase management',`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}`,{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`});
if(project?.ok){const data=await project.json();console.log(`Supabase project state: ${data.status||'unknown'}`)}
await check('Supabase schema availability',`${url}/rest/v1/profiles?select=id&limit=0`,{apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY});
try{const service=new RoomServiceClient(env.LIVEKIT_URL,env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET);const rooms=await service.listRooms();console.log(`LiveKit server API: OK (${rooms.length} active rooms)`)}catch{console.log('LiveKit server API: CONNECTION_OR_AUTH_FAILED')}
