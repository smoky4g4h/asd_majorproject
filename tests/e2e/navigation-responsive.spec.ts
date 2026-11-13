import {test,expect} from '@playwright/test';
test('global rail keeps its DOM identity and position through navigation',async({page})=>{
 await page.goto('/login');await page.locator('.profiles').getByRole('button',{name:/Priya Sharma/}).click();await expect(page).toHaveURL(/dashboard$/);
 const rail=await page.locator('.product-rail').elementHandle();const bounds=await rail!.boundingBox();
 for(const route of ['Documents','Users','Action items','Calendar']){await page.getByRole('link',{name:route,exact:true}).click();await expect.poll(()=>rail!.evaluate(el=>el.isConnected)).toBe(true);expect(await rail!.boundingBox()).toEqual(bounds);await expect(page.locator('.product-rail')).toHaveCount(1);}
 await page.getByRole('button',{name:'Next period',exact:true}).click();await expect(page.getByRole('heading',{name:'20 – 26 November'})).toBeVisible();await page.getByRole('link',{name:'Documents',exact:true}).click();await page.getByRole('link',{name:'Calendar',exact:true}).click();await expect(page.getByRole('heading',{name:'20 – 26 November'})).toBeVisible();
 await page.getByRole('link',{name:'Documents',exact:true}).click();await expect(page.locator('.content')).toBeVisible();expect(await page.locator('.content').evaluate(el=>getComputedStyle(el).fontFamily)).toContain('DM Sans');
});
test('calendar fits desktop, tablet and phone without cutting off Sunday or Notes',async({page})=>{
 for(const width of [1824,1440,1280,768,390,320]){
  await page.setViewportSize({width,height:900});await page.goto('/calendar');await expect(page.getByRole('heading',{name:width<=600?'13 November':'13 – 19 November'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const sunday=page.locator('.rc-day-headings>button').last();const main=page.locator('.rc-main');
  const schedule=page.locator('.rc-schedule');
  await schedule.evaluate(el=>{el.scrollLeft=el.scrollWidth});
  const dayBox=await sunday.boundingBox(), mainBox=await main.boundingBox();expect(dayBox!.x+dayBox!.width).toBeLessThanOrEqual(mainBox!.x+mainBox!.width+1);
  await schedule.evaluate(el=>{el.scrollLeft=0});
  await page.screenshot({path:`artifacts/calendar-responsive-${width}.png`});
  if(await page.getByRole('button',{name:'Notes',exact:true}).isVisible()){await page.getByRole('button',{name:'Notes',exact:true}).click();await expect(page.locator('.rc-notes')).toBeVisible();const notes=await page.locator('.rc-notes').boundingBox();expect(notes!.x+notes!.width).toBeLessThanOrEqual(width);await page.screenshot({path:`artifacts/calendar-notes-${width}.png`});await page.getByRole('button',{name:'Close notes panel',exact:true}).click();await expect(page.locator('.rc-notes')).toBeHidden()}
  if(await page.getByRole('button',{name:'Calendars',exact:true}).isVisible()){await page.getByRole('button',{name:'Calendars',exact:true}).click();await expect(page.locator('.rc-sidebar')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.rc-sidebar')).toBeHidden()}
 }
});
