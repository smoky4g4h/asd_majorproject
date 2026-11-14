import {test,expect,type Page} from '@playwright/test';

// Authorized API fixture; this suite checks layout, not hosted login.
async function workspace(page:Page){const id='00000000-0000-4000-8000-000000000001';const start=new Date();start.setHours(9,0,0,0);await page.route('**/api/workspace',route=>route.fulfill({json:{data:{currentUserId:id,organizationId:id,organizations:[{id,name:'AICTE SecureMeet',icon:'orange',role:'PLATFORM_ADMIN'}],users:[{id,name:'Calendar host',role:'PLATFORM_ADMIN',active:true,affiliation:'AICTE'}],meetings:[{id,title:'Daily Standup',description:'',organizerId:id,participantIds:[id],state:'SCHEDULED',startAt:start.toISOString(),endAt:new Date(start.getTime()+3600000).toISOString(),agenda:[],rsvp:{}}],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));}

test('calendar reserves readable space when the global navigation is expanded',async({page})=>{
 await page.setViewportSize({width:1512,height:950});
 await workspace(page);await page.goto('/calendar');
 await expect(page.getByRole('button',{name:'Daily Standup',exact:true})).toBeVisible();
 await page.screenshot({path:'artifacts/calendar-space-1512.png'});
 const main=await page.locator('.rc-main').boundingBox();
 expect(main!.width).toBeGreaterThanOrEqual(850);
 const title=page.locator('.rc-event[title="Daily Standup"] .rc-event-title');
 expect(await title.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 const toolbar=await page.locator('.rc-toolbar').boundingBox();
 expect(toolbar!.height).toBeLessThanOrEqual(70);
});

test('desktop navigation can collapse and keeps that preference across routes and reloads',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await workspace(page);await page.goto('/dashboard');
 await expect(page).toHaveURL(/dashboard$/);
 const rail=await page.locator('.product-rail').elementHandle();
 await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Expand sidebar',exact:true})).toHaveAttribute('aria-expanded','false');
 expect((await rail!.boundingBox())!.width).toBeLessThanOrEqual(72);
 await page.getByRole('link',{name:'Calendar',exact:true}).click();
 expect(await rail!.evaluate(el=>el.isConnected)).toBe(true);
 expect((await rail!.boundingBox())!.width).toBeLessThanOrEqual(72);
 await page.reload();
 await expect(page.getByRole('button',{name:'Expand sidebar',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
 expect((await page.locator('.product-rail').boundingBox())!.width).toBeGreaterThan(200);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
