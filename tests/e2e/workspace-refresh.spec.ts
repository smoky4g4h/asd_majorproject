import {test,expect} from '@playwright/test';
import type {State} from '../../lib/domain';
// Explicit API fixtures isolate browser scheduling, not hosted latency or authentication.
test('coalesces initial workspace loading and preserves navigation without reloading it',async({page})=>{
 let reads=0;
 await page.route('**/api/workspace',async route=>{
  reads++;await new Promise(resolve=>setTimeout(resolve,250));
  await route.fulfill({json:{data:{currentUserId:'admin',users:[{id:'admin',name:'Test administrator',role:'PLATFORM_ADMIN',active:true,affiliation:'Test'}],meetings:[],tasks:[],documents:[],notifications:[],notes:{}},error:null}});
 });
 await page.goto('/users');await expect(page.getByRole('button',{name:'Invite user',exact:true})).toBeVisible();
 await page.waitForTimeout(600);
 expect(reads).toBe(1);
 await expect(page.locator('.calendar-surface')).toHaveCount(0);
 await page.getByRole('link',{name:'My Task',exact:true}).click();
 await expect(page.getByRole('main',{name:'My task board'})).toBeVisible();expect(reads).toBe(1);
 const rail=await page.locator('.product-rail').elementHandle();
 await page.getByRole('link',{name:'Calendar',exact:true}).click();
 await page.getByRole('button',{name:'Next period',exact:true}).click();
 await expect(page.getByRole('heading',{name:'20 – 26 November'})).toBeVisible();
 await page.getByRole('link',{name:'Users',exact:true}).click();
 await page.getByRole('link',{name:'Calendar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'20 – 26 November'})).toBeVisible();
 expect(await rail!.evaluate(el=>el.isConnected)).toBe(true);expect(reads).toBe(1);
});

test('a task save uses one write when its note is unchanged and ignores a stale poll',async({page})=>{
 let reads=0,writes=0,releasePoll=()=>{};
 const snapshot:State={currentUserId:'admin',users:[{id:'admin',name:'Administrator',role:'PLATFORM_ADMIN',active:true,affiliation:'Test'}],meetings:[{id:'meeting',title:'Test meeting',organizerId:'admin',participantIds:['admin'],description:'',agenda:[],rsvp:{},state:'SCHEDULED',startAt:'2026-11-08T10:00:00Z',endAt:'2026-11-08T11:00:00Z'}],tasks:[{id:'task',title:'Persist this task',assignee:'admin',meetingId:'meeting',done:false,status:'To-do',due:'2026-11-08T10:00:00Z'}],documents:[],notifications:[],notes:{}};
 await page.clock.install();
 await page.route('**/api/workspace',async route=>{
  if(route.request().method()==='POST'){
   writes++;const action=route.request().postDataJSON();
   if(action.type==='task')snapshot.tasks=[action.task];
   await route.fulfill({json:{data:{saved:true},error:null}});return;
  }
  reads++;const data=structuredClone(snapshot);
  if(reads===2)await new Promise<void>(resolve=>{releasePoll=resolve;});
  await route.fulfill({json:{data,error:null}});
 });
 await page.goto('/tasks');await expect(page.getByRole('button',{name:'Persist this task',exact:true})).toBeVisible();
 await page.clock.fastForward(31_000);await expect.poll(()=>reads).toBe(2);
 await page.getByRole('button',{name:'Persist this task',exact:true}).click();
 await page.getByLabel('Status',{exact:true}).selectOption('On-going');
 await page.getByRole('button',{name:'Save task',exact:true}).click();
 await expect(page.locator('.task-editor')).not.toBeVisible();
 await expect(page.getByRole('region',{name:'On Going',exact:true})).toContainText('Persist this task');
 expect(writes).toBe(1);expect(reads).toBe(3);
 releasePoll();
 await page.waitForTimeout(100);
 await expect(page.getByRole('region',{name:'On Going',exact:true})).toContainText('Persist this task');
});

test('pauses background polling and revalidates access when a stale tab becomes visible',async({page})=>{
 let reads=0,denied=false;
 await page.clock.install();
 await page.route('**/api/workspace',async route=>{
  reads++;
  await route.fulfill(denied?{status:401,json:{error:{code:'UNAUTHENTICATED',message:'Sign in again.'}}}:{json:{data:{currentUserId:'admin',users:[{id:'admin',name:'Test administrator',role:'PLATFORM_ADMIN',active:true,affiliation:'Test'}],meetings:[],tasks:[],documents:[],notifications:[],notes:{}}}});
 });
 await page.goto('/users');await expect(page.getByRole('button',{name:'Invite user',exact:true})).toBeVisible();expect(reads).toBe(1);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.fastForward(61_000);expect(reads).toBe(1);
 denied=true;
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();expect(reads).toBe(2);
 await expect(page.getByRole('button',{name:'Invite user',exact:true})).toHaveCount(0);
});
