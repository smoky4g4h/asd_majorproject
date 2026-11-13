import {test,expect} from '@playwright/test';
test('anonymous visitors cannot load calendar or impersonate a stored demo identity',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('securemeet-v1',JSON.stringify({currentUserId:'u-coordinator',users:[{id:'u-coordinator',role:'ADMIN',active:true}],meetings:[],tasks:[],documents:[]})));
 await page.goto('/calendar');
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
 await expect(page.getByText('Callour Studio')).toHaveCount(0);
 await expect(page.getByText('Priya Sharma')).toHaveCount(0);
 const result=await page.request.get('/api/workspace');expect(result.status()).toBe(401);
 expect(result.headers()['cache-control']).toContain('no-store');
 await page.screenshot({path:'artifacts/google-login.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
