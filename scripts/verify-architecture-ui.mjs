// End-to-end checks for the performance architecture on a running build (DemoTech repository, real Ollama).
// Usage: node scripts/verify-architecture-ui.mjs [base]
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const base=process.argv[2]||'http://127.0.0.1:3210';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1500,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');const checks=[];const report={base,checks,errors};
try{
 await page.goto(base);const canvas=page.locator('.spatial-canvas canvas');await canvas.waitFor();await page.waitForFunction(()=>Number(document.querySelector('.spatial-graph')?.getAttribute('data-node-count'))>0);await page.waitForTimeout(2500);
 const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+140,box.y+box.height/2+40,{steps:15});await page.mouse.up();await page.waitForTimeout(2500);
 await page.mouse.move(5,5);await page.waitForTimeout(1500);const before=(await canvas.screenshot()).toString('base64');
 await page.getByRole('button',{name:/ספריית מסמכים/}).click();await page.locator('.document-grid article').first().waitFor();
 await page.getByRole('button',{name:/המוח הארגוני/}).click();await canvas.waitFor();await page.waitForTimeout(2500);
 // Compare pixels with a small tolerance (GPU anti-aliasing can differ by a few values); a moved camera changes most pixels.
 const after=(await canvas.screenshot()).toString('base64');
 report.cameraPixelDifference=await page.evaluate(async([a,b])=>{const load=async s=>{const img=await createImageBitmap(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))],{type:'image/png'}));const c=new OffscreenCanvas(img.width,img.height);const x=c.getContext('2d');x.drawImage(img,0,0);return x.getImageData(0,0,img.width,img.height).data;};const [p,q]=await Promise.all([load(a),load(b)]);let changed=0;for(let i=0;i<p.length;i+=4)if(Math.abs(p[i]-q[i])+Math.abs(p[i+1]-q[i+1])+Math.abs(p[i+2]-q[i+2])>24)changed++;return changed/(p.length/4);},[before,after]);
 assert.ok(report.cameraPixelDifference<.005,`camera and scene must be preserved after visiting the library (changed ${(report.cameraPixelDifference*100).toFixed(2)}% of pixels)`);checks.push('camera position and scene preserved across the library view (no remount)');
 const t=performance.now();await page.getByRole('textbox',{name:'שאלה למסמכי הארגון'}).fill('מה קוד הבקרה של נוהל הרכש?');await page.getByRole('button',{name:'שליחת שאלה'}).click();
 await page.locator('.message.assistant').filter({hasText:'DT-RAG-7319'}).waitFor({timeout:240000});report.chatMs=Math.round(performance.now()-t);
 await page.locator('.graph-note').filter({hasText:'מודגשים בגרף'}).waitFor();checks.push('chat answer with the control code, sources and graph highlighting');
 await page.locator('.sources button').first().click();await page.locator('.evidence').waitFor();await page.locator('.document-text').waitFor();checks.push('source opens evidence and real document text');
 await page.locator('.relation').nth(1).waitFor();const relations=await page.locator('.relation').count();assert.ok(relations>1);
 await page.getByRole('button',{name:/הצגת הצומת והשכנים שלו במפה/}).click();await page.locator('.map-trail').filter({hasText:'שכנים של'}).waitFor();checks.push('lazy neighbourhood expansion from the details panel');
 await page.getByRole('button',{name:/סקירת הקבוצות/}).click();await page.locator('.map-trail').waitFor({state:'detached'});
 await page.getByRole('button',{name:'גרף דו־ממדי',exact:true}).click();await page.locator('.graph-canvas canvas').first().waitFor();await page.getByRole('button',{name:'גרף תלת־ממדי',exact:true}).click();await canvas.waitFor();checks.push('2D/3D switch after a chat answer');
 await page.getByRole('button',{name:/ספריית מסמכים/}).click();await page.locator('.document-grid article').nth(19).waitFor();
 await page.getByRole('textbox',{name:'חיפוש מסמכים'}).fill('HR-');await page.waitForFunction(()=>document.querySelectorAll('.document-grid article').length===4,null,{timeout:10000});checks.push('server-side library search (4 HR documents)');
 assert.deepEqual(errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}finally{await browser.close();await writeFile('reports/performance/architecture-ui-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
