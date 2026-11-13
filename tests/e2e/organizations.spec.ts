import {test,expect} from '@playwright/test';
const admin='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002';
const orange='00000000-0000-4000-8000-000000000101',purple='00000000-0000-4000-8000-000000000102',blue='00000000-0000-4000-8000-000000000103';
const organizations=[{id:orange,name:'AICTE SecureMeet',icon:'orange',role:'PLATFORM_ADMIN'},{id:purple,name:'Design Studio',icon:'purple',role:'ORG_ADMIN'},{id:blue,name:'Project Studio',icon:'blue',role:'ORG_ADMIN'}];
async function setup(page:any){
 let selected=orange;const writes:any[]=[];
 await page.route('**/api/workspace',async(route:any)=>{
  const org=route.request().headers()['x-workspace-id']||selected;
  if(route.request().method()==='POST')return route.fulfill({json:{data:{saved:true},error:null}});
  const start=new Date();start.setHours(10,0,0,0);
  await route.fulfill({json:{data:{organizationId:org,organizations,currentUserId:admin,users:[{id:admin,name:'Vignesh',email:'vignesh@gmail.com',role:'PLATFORM_ADMIN',active:true,affiliation:'AICTE',mfaEnabled:true},{id:member,name:'Registered Colleague',email:'colleague@gmail.com',role:'MEMBER',active:true,affiliation:'AICTE',mfaEnabled:false}],meetings:[{id:org,title:org===orange?'Committee review':'Design review',description:'',organizerId:admin,participantIds:[admin],startAt:start.toISOString(),endAt:new Date(start.getTime()+3600000).toISOString(),state:'SCHEDULED',agenda:[],rsvp:{}}],tasks:[],documents:[],notifications:[],notes:{}},error:null}});
 });
 await page.route('**/api/organizations',async(route:any)=>{const input=route.request().postDataJSON();writes.push({...input,scope:route.request().headers()['x-workspace-id']});if(input.action==='switch')selected=input.organizationId;await route.fulfill({json:{data:{organizationId:selected,saved:true},error:null}})});
 return writes;
}
test('header and calendar switch the same authorized organization and scope data',async({page})=>{
 await page.setViewportSize({width:1600,height:1000});const writes=await setup(page);await page.goto('/calendar');
 await expect(page.getByRole('button',{name:'Switch calendar organization'})).toContainText('AICTE SecureMeet');
 await expect(page.getByRole('button',{name:'Committee review',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Switch calendar organization'}).click();await page.locator('.organization-menu').getByRole('button',{name:'Design Studio'}).click();
 await expect(page.getByRole('button',{name:'Switch calendar organization'})).toContainText('Design Studio');
 await expect(page.getByRole('button',{name:'Committee review',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Design review',exact:true})).toBeVisible();
 expect(writes[0]).toMatchObject({action:'switch',organizationId:purple});await page.screenshot({path:'artifacts/organizations-calendar.png'});
 await page.getByRole('button',{name:'Switch to Project Studio'}).click();await expect(page.getByRole('button',{name:'Switch to Project Studio'})).toHaveAttribute('aria-pressed','true');
});
test('uses registered identity and saves membership without editing account identity',async({page})=>{
 const writes=await setup(page);await page.goto('/users');await expect(page.getByRole('link',{name:'colleague@gmail.com'})).toBeVisible();await expect(page.getByText('PLATFORM_ADMIN',{exact:true})).toHaveCount(0);await expect(page.getByRole('cell',{name:'Participant',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit Registered Colleague',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Email address',{exact:true})).toHaveAttribute('readonly','');await page.getByRole('dialog').getByRole('combobox',{name:'Organization',exact:true}).selectOption(purple);await page.getByRole('dialog').getByRole('combobox',{name:'Role',exact:true}).selectOption('ORGANIZER');await page.getByRole('button',{name:'Save membership',exact:true}).click();await expect(page.getByText('Registered Colleague: membership saved')).toBeVisible();expect(writes[0]).toMatchObject({action:'member',organizationId:purple,userId:member,role:'ORGANIZER',scope:orange});
});
test('organization plus requires name and icon, while Create schedules meetings',async({page})=>{
 const writes=await setup(page);await page.goto('/users');await page.getByRole('button',{name:'Create organization',exact:true}).click();await page.getByLabel('Organization name').fill('Research group');await page.getByRole('button',{name:'blue icon'}).click();await page.getByRole('dialog').getByRole('button',{name:'Create organization',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:'create',name:'Research group',icon:'blue'});
 await page.getByRole('button',{name:'Create workspace item'}).click();await page.getByRole('link',{name:'Schedule meeting',exact:true}).click();await expect(page.getByLabel('Meeting title')).toBeVisible();
});
test('mobile calendar and header fit the viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await page.goto('/calendar');await expect(page.getByRole('button',{name:'Switch to AICTE SecureMeet'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/organizations-mobile.png'});
});
