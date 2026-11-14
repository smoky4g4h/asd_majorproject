// Optional external worker: same secret as the app, no browser/session required.
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const origin=process.env.NEXT_PUBLIC_APP_URL,secret=process.env.MEDIA_WORKER_SECRET;
if(!origin||!secret)throw Error('NEXT_PUBLIC_APP_URL and MEDIA_WORKER_SECRET are required.');
const endpoint=new URL('/api/internal/media-recovery',origin);
if(endpoint.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(endpoint.hostname))throw Error('Worker requires HTTPS.');
let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
do{try{const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+secret},signal:AbortSignal.timeout(120000)});if(!response.ok)console.error('Meeting worker HTTP',response.status);else {const result=await response.json();console.log('Meeting worker',JSON.stringify(result.data));}}catch{console.error('Meeting worker could not reach the app; will retry.')}if(process.argv.includes('--once'))break;if(!stopped)await new Promise(resolve=>setTimeout(resolve,15000));}while(!stopped);
