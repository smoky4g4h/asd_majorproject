import {test,expect} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
// API fixtures verify UI persistence/retry integration, not hosted delivery.
test('sidebar sends a shared message, keeps retry ID, and reloads saved history',async({page})=>{
 const saved:{id:string;author_id:string;body:string;created_at:string;deleted_at:null}[]=[];const keys:string[]=[];
 await page.route('**/api/workspace',route=>route.fulfill({json:{data:{currentUserId:id,users:[{id,name:'Host',role:'MEMBER',active:true},{id:other,name:'Colleague',role:'MEMBER',active:true}],meetings:[],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));
 await page.route('**/api/chats',route=>route.fulfill({json:{data:{id},error:null}}));
 await page.route('**/api/chats/*/sync',route=>route.fulfill({json:{data:{messages:[...saved].reverse()},error:null}}));
 await page.route('**/api/chats/*/read',route=>route.fulfill({json:{data:{read:true},error:null}}));
 await page.route('**/api/chats/*/messages',route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{data:{messages:saved,nextCursor:null},error:null}});
  const body=route.request().postDataJSON();keys.push(body.clientMessageId);
  if(keys.length===1)return route.fulfill({status:503,json:{data:null,error:{message:'Connection interrupted. Retry.'}}});
  const message={id:other,author_id:id,body:body.body,created_at:new Date().toISOString(),deleted_at:null};saved.push(message);return route.fulfill({json:{data:message,error:null}});
 });
 await page.goto('/dashboard');await page.getByRole('button',{name:'Message Colleague',exact:true}).click();
 await page.getByLabel('Message',{exact:true}).fill('Persistent hello');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByText('Connection interrupted. Retry.')).toBeVisible();
 await page.getByRole('button',{name:'Retry send',exact:true}).click();
 await expect(page.getByRole('log').getByText('Persistent hello')).toBeVisible();expect(keys[1]).toBe(keys[0]);
 await page.reload();await page.getByRole('button',{name:'Message Colleague',exact:true}).click();
 await expect(page.getByRole('log').getByText('Persistent hello')).toBeVisible();expect(saved).toHaveLength(1);
});

test('edits and deletes own messages, syncs remote edits, and disables unconfigured scheduling',async({page})=>{
 let saved={id:other,author_id:id,body:'Original message',created_at:new Date().toISOString(),deleted_at:null as string|null,revision:1};
 await page.route('**/api/workspace',r=>r.fulfill({json:{data:{currentUserId:id,users:[{id,name:'Host',role:'MEMBER',active:true},{id:other,name:'Colleague',role:'MEMBER',active:true}],meetings:[],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));
 await page.route('**/api/chats',r=>r.fulfill({json:{data:{id}}}));
 await page.route('**/api/chats/*/messages',r=>r.fulfill({json:{data:{messages:[saved],nextCursor:null}}}));
 await page.route('**/api/chats/*/sync',r=>r.fulfill({json:{data:{messages:[saved]}}}));
 await page.route('**/api/chats/*/read',r=>r.fulfill({json:{data:{read:true}}}));
 await page.route('**/api/chats/*/scheduled',r=>r.fulfill({json:{data:{messages:[],enabled:false}}}));
 await page.route('**/api/chats/*/change',r=>{const input=r.request().postDataJSON();expect(input.revision).toBe(saved.revision);saved={...saved,body:input.action==='delete'?'':input.body,deleted_at:input.action==='delete'?new Date().toISOString():null,revision:saved.revision+1};return r.fulfill({json:{data:saved}})});
 await page.goto('/dashboard');await page.getByRole('button',{name:'Message Colleague',exact:true}).click();
 await page.getByRole('button',{name:'Edit this message'}).click();await page.getByLabel('Edit message',{exact:true}).fill('Corrected message');await page.getByRole('button',{name:'Save edit'}).click();await expect(page.getByRole('log').getByText('Corrected message')).toBeVisible();
 saved={...saved,body:'Edited on another device',revision:3};await page.getByRole('button',{name:'Refresh conversation'}).click();await expect(page.getByRole('log').getByText('Edited on another device')).toBeVisible();
 page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete this message'}).click();await expect(page.getByRole('log').getByText('Message deleted')).toBeVisible();await expect(page.getByRole('button',{name:'Edit this message'})).toHaveCount(0);
 await page.getByRole('button',{name:'Send later',exact:true}).click();await expect(page.getByText('Scheduled delivery is not enabled yet.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Schedule message',exact:true})).toBeDisabled();
});
