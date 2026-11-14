import {test,expect} from '@playwright/test';

test('task board supports creation, moves, notes, completion and persistence',async({page})=>{
 await page.setViewportSize({width:1600,height:1100});
 await page.goto('/login');await page.locator('.profiles').getByRole('button',{name:/Priya Sharma/}).click();
 await page.getByRole('link',{name:'Action items',exact:true}).click();
 for(const name of ['To Do','On Going','On Review'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 expect((await page.locator('.task-reference-portraits').first().boundingBox())!.width).toBeGreaterThan(25);
 await page.screenshot({path:'artifacts/task-board-desktop.png',fullPage:true});
 const ongoing=page.getByRole('region',{name:'On Going',exact:true});
 await ongoing.getByRole('button',{name:'Add New Task',exact:true}).click();
 await page.getByLabel('Task title',{exact:true}).fill('Board acceptance task');
 await page.getByLabel('Description',{exact:true}).fill('Check the reference layout and keyboard workflow.');
 await page.getByLabel('Checklist items',{exact:true}).fill('Review layout\nCheck keyboard navigation');
 await page.getByRole('button',{name:'Save task',exact:true}).click();
 const card=page.locator('.task-board-card').filter({hasText:'Board acceptance task'});
 await expect(ongoing).toContainText('Board acceptance task');
 await card.dragTo(page.getByRole('region',{name:'On Review',exact:true}));
 await expect(page.getByRole('region',{name:'On Review',exact:true})).toContainText('Board acceptance task');
 await page.reload();await expect(page.getByRole('region',{name:'On Review',exact:true})).toContainText('Board acceptance task');
 await page.getByRole('button',{name:'Board acceptance task',exact:true}).click();
 await page.getByRole('checkbox',{name:'Review layout',exact:true}).check();
 await page.getByRole('textbox',{name:'Private task note',exact:true}).fill('Ready for review.');
 await page.getByLabel('Status',{exact:true}).selectOption('Done');
 await page.getByRole('button',{name:'Save task',exact:true}).click();
 await expect(card).toHaveCount(0);
 await page.getByRole('button',{name:'To Do options',exact:true}).click();
 await page.getByRole('button',{name:/Completed tasks/}).click();
 await page.getByRole('button',{name:'Reopen Board acceptance task',exact:true}).click();
 await page.getByRole('button',{name:'Close completed tasks',exact:true}).click();
 await expect(page.getByRole('region',{name:'To Do',exact:true})).toContainText('Board acceptance task');
 await page.getByRole('button',{name:'Board acceptance task',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Private task note',exact:true})).toHaveValue('Ready for review.');
 await expect(page.getByRole('checkbox',{name:'Review layout',exact:true})).toBeChecked();
});

test('board remains usable on small screens and preserves existing tasks',async({page})=>{
 await page.goto('/login');await page.locator('.profiles').getByRole('button',{name:/Priya Sharma/}).click();
 await page.getByRole('link',{name:'Action items',exact:true}).click();
 for(const width of [1440,1024,768,390,320]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.task-board-columns').evaluate(el=>{el.scrollLeft=el.scrollWidth});
  await expect(page.getByRole('region',{name:'On Review',exact:true}).getByRole('button',{name:'Add New Task',exact:true})).toBeInViewport();
  await page.locator('.task-board-columns').evaluate(el=>{el.scrollLeft=0});
  await page.screenshot({path:`artifacts/task-board-${width}.png`,fullPage:true});
 }
 await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('securemeet-v1')!);state.tasks=[{id:'legacy-task',title:'Preserve my existing task',assignee:state.currentUserId,meetingId:state.meetings[0].id,done:false,due:new Date().toISOString()}];localStorage.setItem('securemeet-v1',JSON.stringify(state))});
 await page.reload();await expect(page.getByRole('region',{name:'To Do',exact:true})).toContainText('Preserve my existing task');
 expect(await page.locator('.task-board-card').count()).toBe(1);
});
