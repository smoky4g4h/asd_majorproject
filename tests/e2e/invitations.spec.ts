import {test,expect} from '@playwright/test';
// Explicit API fixtures verify UI behavior only; not real OAuth or email proof.
test('administrator can inspect and revoke an invitation without a false email claim',async({page})=>{
 const id='00000000-0000-4000-8000-000000000123';let revoked=false;
 await page.route('**/api/workspace',route=>route.fulfill({json:{data:{currentUserId:'admin',users:[{id:'admin',name:'Test administrator',role:'PLATFORM_ADMIN',active:true,affiliation:'Test workspace'}],meetings:[],tasks:[],documents:[],notifications:[],notes:{}},error:null}}));
 await page.route('**/api/invitations',route=>route.fulfill({json:{data:{items:[{id,email:'recipient@example.com',role:'MEMBER',status:revoked?'REVOKED':'PENDING',delivery_status:'PENDING',expires_at:'2099-01-01T00:00:00Z',linkReady:true}],nextCursor:null,inviteUrl:'http://localhost:3000/auth/accept-invite'},error:null}}));
 await page.route('**/api/invitations/'+id+'/revoke',route=>{revoked=true;return route.fulfill({json:{data:{revoked:true},error:null}})});
 await page.goto('/users');await page.getByRole('button',{name:'Invitations',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Invitations'});
 await expect(dialog.getByLabel('Invitation link for recipient@example.com')).toHaveValue('http://localhost:3000/auth/accept-invite?invitation='+id);
 await dialog.getByRole('button',{name:'Revoke invitation for recipient@example.com'}).click();
 await dialog.getByRole('button',{name:'Confirm revoke',exact:true}).click();
 await expect(dialog.getByText('Member · revoked')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Copy link'})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:'artifacts/v2-invitations-mobile.png',fullPage:true});
});

test('creates a personal link with the selected role without email setup',async({page})=>{
 const invitation='00000000-0000-4000-8000-000000000123';
 await page.route('**/api/workspace',route=>route.fulfill({json:{data:{currentUserId:'admin',users:[{id:'admin',name:'Administrator',role:'PLATFORM_ADMIN',active:true}],meetings:[],tasks:[],documents:[],notifications:[],notes:{}}}}));
 await page.route('**/api/users/invite',route=>{
  expect(route.request().postDataJSON()).toEqual({email:'recipient@example.com',role:'ORGANIZER'});
  return route.fulfill({status:201,json:{data:{id:invitation,deliveryStatus:'MANUAL',inviteUrl:'https://secure.example/auth/accept-invite?invitation='+invitation}}});
 });
 await page.goto('/users');await page.getByRole('button',{name:'Invite user',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Email address').fill('recipient@example.com');await dialog.getByRole('combobox').selectOption('ORGANIZER');
 await dialog.getByRole('button',{name:'Create invitation link',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('Invitation link created for recipient@example.com');
 await expect(dialog.getByLabel('Invitation link')).toHaveValue('https://secure.example/auth/accept-invite?invitation='+invitation);
 await expect(dialog.getByText(/No email has been sent/)).toBeVisible();await expect(dialog.getByRole('alert')).toHaveCount(0);
});
