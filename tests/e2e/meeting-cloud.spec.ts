import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {AccessToken,RoomServiceClient,TrackSource} from 'livekit-server-sdk';
import {loadEnvConfig} from '@next/env';
import {randomUUID} from 'node:crypto';
import {closeMediaRoom} from '../../lib/meeting-media/lifecycle';
// Opt-in real SFU integration. Auth/admission are explicit fixtures; media is generated, not recorded.
// No traces/videos: HTTP responses contain short-lived room credentials.
test.use({trace:'off',video:'off',screenshot:'off',launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']}});
test('two browsers exchange real Cloud tracks, screen share, chat, and host moderation',async({browser})=>{
 test.skip(process.env.LIVEKIT_CLOUD_SMOKE!=='1','Explicitly enable isolated LiveKit Cloud test.');
 test.setTimeout(180000);
 loadEnvConfig(process.cwd(),true,{info(){},error(){}});
 const url=process.env.LIVEKIT_URL!,key=process.env.LIVEKIT_API_KEY!,secret=process.env.LIVEKIT_API_SECRET!;
 expect(Boolean(url&&key&&secret)).toBe(true);
 const service=new RoomServiceClient(url.replace(/^wss:/,'https:'),key,secret,{requestTimeout:10,failover:false});
 const room='securemeet-qa-'+randomUUID(),mid=randomUUID(),host=randomUUID(),guest=randomUUID(),requestId=randomUUID(),thread=randomUUID();
 const contexts:BrowserContext[]=[];const messages:any[]=[];let requested=false,approved=false,removed=false,ended=false;
 const token=async(identity:string)=>{const value=new AccessToken(key,secret,{identity,name:identity===host?'QA Host':'QA Guest',ttl:300});value.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:false});return value.toJwt()};
 const hostToken=await token(host),guestToken=await token(guest);
 async function setup(identity:string,cachedReplay=false){
  const context=await browser.newContext({permissions:['camera','microphone']});contexts.push(context);
  await context.addInitScript(()=>{
   // Generated canvas replaces the OS share chooser only in this test.
   navigator.mediaDevices.getDisplayMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d')!;let frame=0;const timer=setInterval(()=>{context.fillStyle=frame++%2?'#167a65':'#3d4ac9';context.fillRect(0,0,640,360);context.fillStyle='white';context.fillText('SecureMeet generated share '+frame,20,30)},100);const stream=canvas.captureStream(10);stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream};
   const Original=window.RTCPeerConnection;
   (window as any).__qaConnections=[];
   window.RTCPeerConnection=new Proxy(Original,{construct(Target,args){const value=new Target(...args);(window as any).__qaConnections.push(value);return value}});
  });
  const page=await context.newPage();page.on('dialog',dialog=>dialog.accept());
  await page.route('**/api/workspace',route=>route.fulfill({json:{data:{currentUserId:identity,users:[{id:host,name:'QA Host',role:'ORGANIZER',active:true},{id:guest,name:'QA Guest',role:'MEMBER',active:true}],meetings:[{id:mid,title:'Isolated two-browser meeting',organizerId:host,participantIds:[host,guest],state:ended&&!cachedReplay?'ENDED':'LIVE',startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString(),agenda:['Verify generated media'],description:'QA room',rsvp:{}}],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));
  await page.route('**/api/meetings/**',async route=>{
   const action=new URL(route.request().url()).pathname.split('/').slice(4).join('/');
   let data:any={status:'CONFIRMED'};
   if(action==='admission-request'){requested=true;data={status:'PENDING'}}
   if(action==='admission-requests')data=requested?[{id:requestId,user_id:guest,display_name:'QA Guest',status:cachedReplay?'APPROVED':removed?'REJECTED':approved?'APPROVED':'PENDING'}]:[];
   if(action===`admissions/${requestId}/approve`)approved=true;
   if(action==='room-token'){
    if(!cachedReplay&&(ended||(identity===guest&&(!approved||removed))))return route.fulfill({status:403,json:{data:null,error:{message:'Access revoked.'}}});
    data={token:identity===host?hostToken:guestToken,serverUrl:url};
   }
   if(action==='mute-participant'){const body=route.request().postDataJSON();await service.mutePublishedTrack(room,body.userId,body.trackSid,true)}
   if(action==='remove-participant'){removed=true;await service.removeParticipant(room,guest,{revokeTokenTs:BigInt(Math.floor(Date.now()/1000)+1)})}
   if(action==='end'){ended=true;await closeMediaRoom(service,room,[host,guest])}
   await route.fulfill({json:{data,error:null}});
  });
  await page.route('**/api/chats',route=>route.fulfill({json:{data:{id:thread},error:null}}));
  await page.route('**/api/chats/*/sync',route=>route.fulfill({json:{data:{messages:[...messages].reverse()},error:null}}));
  await page.route('**/api/chats/*/read',route=>route.fulfill({json:{data:{read:true},error:null}}));
  await page.route('**/api/chats/*/messages',route=>{if(route.request().method()==='GET')return route.fulfill({json:{data:{messages:[...messages].reverse(),nextCursor:null},error:null}});const input=route.request().postDataJSON();const row={id:randomUUID(),author_id:identity,body:input.body,created_at:new Date().toISOString(),deleted_at:null};messages.push(row);return route.fulfill({json:{data:row,error:null}})});
  await page.goto('/meetings/'+mid+'/room');return page;
 }
 async function bytes(page:Page){return page.evaluate(async()=>{let audio=0,video=0;for(const connection of (window as any).__qaConnections||[]){if(connection.connectionState==='closed')continue;const stats=await connection.getStats();stats.forEach((report:any)=>{if(report.type==='inbound-rtp'){if(report.kind==='audio')audio+=report.bytesReceived||0;if(report.kind==='video')video+=report.bytesReceived||0}})}return {audio,video}})}
 try{
  await closeMediaRoom(service,room+'-never-started',[randomUUID()]);
  await service.createRoom({name:room,emptyTimeout:60,maxParticipants:4});
  const a=await setup(host),b=await setup(guest);
  await a.getByRole('button',{name:'Start and join meeting',exact:true}).click();
  await expect(a.getByText('Connected',{exact:true})).toBeVisible({timeout:30000});
  await b.getByRole('button',{name:'Request admission',exact:true}).click();
  await expect(a.getByRole('button',{name:'Admit',exact:true})).toBeVisible({timeout:10000});await a.getByRole('button',{name:'Admit',exact:true}).click();
  await expect(b.getByText('Connected',{exact:true})).toBeVisible({timeout:30000});
  // Controls come from the real LiveKit component; media starts off intentionally.
  for(const page of [a,b]){
   await page.locator('.lk-control-bar button[data-lk-source="microphone"]').click();
   await page.locator('.lk-control-bar button[data-lk-source="camera"]').click();
  }
  for(const page of [a,b])await expect.poll(async()=>{const value=await bytes(page);return value.audio>0&&value.video>0},{timeout:30000}).toBe(true);
  await a.locator('.lk-control-bar button[data-lk-source="screen_share"]').click();
  await expect.poll(async()=>{const people=await service.listParticipants(room);return people.some(person=>person.identity===host&&person.tracks.some(track=>track.source===TrackSource.SCREEN_SHARE))},{timeout:15000}).toBe(true);
  await expect(b.locator('video[data-lk-source="screen_share"]')).toBeVisible({timeout:15000});
  await a.getByLabel('Message',{exact:true}).fill('Two-browser meeting chat');await a.getByRole('button',{name:'Send message',exact:true}).click();
  await b.bringToFront();
  await expect(b.getByRole('log').getByText('Two-browser meeting chat')).toBeVisible({timeout:20000});
  await a.getByRole('button',{name:'Chat',exact:true}).click();
  await expect(a.locator('#live-chat')).toBeHidden();
  await a.getByRole('button',{name:'Chat',exact:true}).click();
  await expect(a.getByRole('log').getByText('Two-browser meeting chat')).toBeVisible();
  await a.evaluate(()=>window.scrollTo(0,0));
  await expect(a.locator('.lk-control-bar')).toBeInViewport({ratio:1});
  await a.screenshot({path:'artifacts/meeting-cloud-desktop.png'});
  await b.setViewportSize({width:390,height:844});
  expect(await b.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(b.locator('.lk-control-bar')).toBeInViewport({ratio:1});
  await b.screenshot({path:'artifacts/meeting-cloud-mobile.png'});
  await b.setViewportSize({width:1280,height:720});
  await b.context().setOffline(true);
  try{await expect(b.getByText('Connection interrupted. Reconnecting…',{exact:true})).toBeVisible({timeout:25000})}finally{await b.context().setOffline(false)}
  await expect(b.getByText('Connected',{exact:true})).toBeVisible({timeout:30000});
  const received=await bytes(b);await expect.poll(async()=>(await bytes(b)).video,{timeout:20000}).toBeGreaterThan(received.video);
  await a.getByRole('button',{name:'Mute microphone',exact:true}).click();
  await expect.poll(async()=>{const person=await service.getParticipant(room,guest);return person.tracks.some(track=>track.source===TrackSource.MICROPHONE&&track.muted)}).toBe(true);
  await a.getByRole('button',{name:'Remove',exact:true}).click();
  await expect(b.getByText('The host removed you from this meeting.',{exact:true})).toBeVisible({timeout:15000});
  const replayGuest=await setup(guest,true);
  await replayGuest.getByRole('button',{name:'Request admission',exact:true}).click();
  await expect(replayGuest.getByRole('heading',{name:'You have left the room',exact:true})).toBeVisible({timeout:30000});
  await a.getByRole('button',{name:'End meeting for everyone',exact:true}).click();
  await expect.poll(async()=>(await service.listRooms([room])).length).toBe(0);
  const replayHost=await setup(host,true);
  await replayHost.getByRole('button',{name:'Start and join meeting',exact:true}).click();
  await expect(replayHost.getByRole('heading',{name:'You have left the room',exact:true})).toBeVisible({timeout:30000});
  expect((await service.listParticipants(room).catch(()=>[])).length).toBe(0);
 }finally{await Promise.all(contexts.map(context=>context.close()));await service.deleteRoom(room).catch(()=>{});}
});
