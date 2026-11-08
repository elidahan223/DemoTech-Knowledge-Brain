import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:950}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[];
try{
 await page.goto(process.argv[2]||'http://127.0.0.1:3211');await page.locator('.stats b').first().filter({hasText:'20'}).waitFor();
 const canvas=page.locator('.spatial-canvas canvas');await canvas.waitFor();await page.waitForTimeout(2700);assert.equal(await page.locator('.graph-fallback').count(),0);assert.ok(Number(await page.locator('.spatial-graph').getAttribute('data-node-count'))>=20);
 await page.screenshot({path:'reports/graph3d-desktop.png',fullPage:true});const before=digest(await canvas.screenshot());
 const box=await canvas.boundingBox();await page.mouse.move(box.x+35,box.y+box.height*.65);await page.mouse.down();await page.mouse.move(box.x+150,box.y+box.height*.65+50,{steps:20});await page.mouse.up();await page.waitForTimeout(800);assert.notEqual(digest(await canvas.screenshot()),before);checks.push('WebGL 3D render and mouse orbit');
 await page.getByRole('button',{name:'הגדלה',exact:true}).click();await page.getByRole('button',{name:'הקטנה',exact:true}).click();await page.getByRole('button',{name:'התאמה',exact:true}).click();
 const rotation=page.getByRole('button',{name:'סיבוב אוטומטי',exact:false});await rotation.click();await page.getByRole('button',{name:'עצירת סיבוב',exact:false}).click();checks.push('zoom, fit and optional automatic rotation');
 await page.getByRole('textbox',{name:'חיפוש בגרף'}).fill('HR-001');await page.locator('.spatial-graph[data-node-count="1"]').waitFor();await page.locator('.graph-node-menu summary').click();await page.locator('.graph-node-menu button').filter({hasText:'HR-001'}).click();await page.locator('.document-text').filter({hasText:'HR-001'}).waitFor();checks.push('search, accessible node selection and real document content');
 await page.getByRole('textbox',{name:'חיפוש בגרף'}).fill('');await page.getByRole('combobox',{name:'סינון סוג צומת'}).selectOption('person');await page.locator('.spatial-graph[data-node-count="5"]').waitFor({timeout:10000});await page.getByRole('combobox',{name:'סינון סוג צומת'}).selectOption('all');
 await page.getByRole('button',{name:'גרף דו־ממדי',exact:true}).click();await page.locator('.graph-canvas canvas').first().waitFor();await page.getByRole('button',{name:'גרף תלת־ממדי',exact:true}).click();await page.locator('.spatial-canvas canvas').waitFor();checks.push('type filtering and reversible 2D/3D switch');
 await page.getByRole('button',{name:/ספריית מסמכים/}).click();await page.locator('.document-grid article').nth(19).waitFor();assert.equal(await page.locator('.document-grid article').count(),20);await page.getByRole('button',{name:'המוח הארגוני',exact:false}).click();await page.locator('.spatial-canvas canvas').waitFor();checks.push('navigation and WebGL cleanup/remount');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1000);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'reports/graph3d-mobile.png',fullPage:true});checks.push('responsive mobile canvas resize without overflow');
 await page.getByRole('textbox',{name:'חיפוש בגרף'}).fill('xyz-no-such-node');await page.getByText('לא נמצאו צמתים התואמים לחיפוש או לסינון.',{exact:true}).waitFor();checks.push('empty-search state');
 await page.getByRole('textbox',{name:'חיפוש בגרף'}).fill('');
 await page.evaluate(()=>{const canvas=document.querySelector('.spatial-canvas canvas');const context=canvas.getContext('webgl2');context.getExtension('WEBGL_lose_context').loseContext();});await page.getByRole('button',{name:'מעבר לתצוגת 2D',exact:true}).click();await page.locator('.graph-canvas canvas').first().waitFor();checks.push('WebGL context loss offers functioning 2D fallback');
 assert.deepEqual(errors,[]);await writeFile('reports/graph3d-validation.json',JSON.stringify({status:'passed',checks,errors},null,2));console.log(JSON.stringify({status:'passed',checks},null,2));
}finally{await browser.close();}
