import {test,expect} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000001';
// Explicit API fixture: verifies UI integration, not real Supabase auth or SFU tracks.
test('real lobby requests admission and shows rejection without a simulated call',async({page})=>{
 const user='00000000-0000-4000-8000-000000000002';let requested=false;
 await page.route('**/api/workspace',route=>route.fulfill({json:{data:{currentUserId:user,users:[{id:user,name:'Test participant',role:'MEMBER',active:true,affiliation:'Test'}],meetings:[{id,title:'Real meeting fixture',organizerId:id,participantIds:[id,user],description:'',agenda:[],rsvp:{},state:'LIVE',startAt:new Date().toISOString(),endAt:new Date(Date.now()+3600000).toISOString()}],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));
 await page.route('**/api/meetings/**',route=>{const url=route.request().url();if(url.endsWith('/admission-request')){requested=true;return route.fulfill({json:{data:{status:'PENDING'},error:null}})}return route.fulfill({json:{data:[{id,user_id:user,status:requested?'REJECTED':'PENDING'}],error:null}})});
 await page.goto('/meetings/'+id+'/room');
 await expect(page.getByRole('heading',{name:'Prepare to join'})).toBeVisible();
 await expect(page.getByText('DEMO PREVIEW')).toHaveCount(0);
 await page.getByRole('button',{name:'Request admission',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Room access unavailable'})).toBeVisible();
 await expect(page.getByText('Your request was declined or your access was removed.')).toBeVisible();
 expect(requested).toBe(true);
});

test('failed meeting creation stays on the form instead of claiming a saved meeting',async({page})=>{
 await page.route('**/api/workspace',route=>route.request().method()==='POST'?route.fulfill({status:422,json:{data:null,error:{code:'INVALID',message:'Meeting could not be saved.'}}}):route.fulfill({json:{data:{currentUserId:id,users:[{id,name:'Test host',role:'PLATFORM_ADMIN',active:true,affiliation:'Test'}],meetings:[],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));
 await page.goto('/meetings/new');
 await page.getByLabel('Meeting title').fill('Persist only after acknowledgement');
 await page.getByRole('button',{name:'Save meeting',exact:true}).click();
 await expect(page.getByText('Meeting could not be saved.').first()).toBeVisible();
 await expect(page).toHaveURL(/\/meetings\/new$/);
 await expect(page.getByLabel('Meeting title')).toHaveValue('Persist only after acknowledgement');
});

test('cancel uses the lifecycle endpoint and hides join after confirmation',async({page})=>{
 let cancelled=false,calls=0;
 await page.route('**/api/workspace',route=>route.fulfill({json:{data:{currentUserId:id,users:[{id,name:'Test host',role:'PLATFORM_ADMIN',active:true,affiliation:'Test'}],meetings:[{id,title:'Cancellation fixture',organizerId:id,participantIds:[id],description:'',agenda:[],rsvp:{},state:cancelled?'CANCELLED':'LIVE',startAt:new Date().toISOString(),endAt:new Date(Date.now()+3600000).toISOString()}],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));
 await page.route('**/api/meetings/'+id+'/cancel',route=>{calls++;cancelled=true;return route.fulfill({json:{data:{id,status:'CONFIRMED'},error:null}})});
 page.on('dialog',dialog=>dialog.accept());
 await page.goto('/meetings/'+id);
 await page.getByRole('button',{name:'Cancel meeting',exact:true}).click();
 await expect(page.getByText('CANCELLED',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Join meeting'})).toHaveCount(0);
 expect(calls).toBe(1);
});

test('failed duplicate keeps the original meeting visible',async({page})=>{
 await page.route('**/api/workspace',route=>route.request().method()==='POST'?route.fulfill({status:422,json:{data:null,error:{code:'INVALID',message:'Copy could not be saved.'}}}):route.fulfill({json:{data:{currentUserId:id,users:[{id,name:'Test host',role:'PLATFORM_ADMIN',active:true,affiliation:'Test'}],meetings:[{id,title:'Original meeting',organizerId:id,participantIds:[id],description:'',agenda:[],rsvp:{},state:'SCHEDULED',startAt:new Date().toISOString(),endAt:new Date(Date.now()+3600000).toISOString()}],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));
 await page.goto('/meetings/'+id);
 await page.getByRole('button',{name:'Duplicate',exact:true}).click();
 await expect(page.getByText('Copy could not be saved.').first()).toBeVisible();
 await expect(page).toHaveURL(new RegExp('/meetings/'+id+'$'));
});

test('a verified cohost sees start controls even when not the organizer',async({page})=>{
 const user='00000000-0000-4000-8000-000000000002';
 await page.route('**/api/workspace',route=>route.fulfill({json:{data:{currentUserId:user,users:[{id:user,name:'Cohost',role:'ORGANIZER',active:true}],meetings:[{id,title:'Cohost meeting',organizerId:id,participantIds:[id,user],description:'',agenda:[],rsvp:{},state:'SCHEDULED',startAt:new Date().toISOString(),endAt:new Date(Date.now()+3600000).toISOString()}],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));
 await page.route('**/api/meetings/**',route=>route.fulfill({json:{data:route.request().url().endsWith('/context')?{meetingRole:'COHOST'}:[],error:null}}));
 await page.goto('/meetings/'+id+'/room');
 await expect(page.getByRole('button',{name:'Start and join meeting',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Host admission controls'})).toBeVisible();
});
