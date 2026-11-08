// Long-running leak test against a running build: repeated UI actions (view switches, community expansion,
// 2D/3D toggles that destroy and recreate the WebGL context) plus hybrid searches. Samples, once a minute:
// browser JS heap after forced GC, DOM nodes, listeners, the browser GPU process memory and the backend memory.
// Usage: node scripts/soak-test.mjs [base] [--minutes=15]
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
const base=process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'http://127.0.0.1:3213';const minutes=Number(process.argv.find(a=>a.startsWith('--minutes='))?.split('=')[1]||15);
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1500,height:950}});const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('HeapProfiler.enable');
const errors=[];page.on('pageerror',e=>errors.push(e.message));
function gpuProcessMB(){try{const out=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*--type=gpu-process*' -and $_.CommandLine -like '*playwright*' } | ForEach-Object { (Get-Process -Id $_.ProcessId).PrivateMemorySize64 }) | Measure-Object -Sum | ForEach-Object { $_.Sum }"],{encoding:'utf8',windowsHide:true}).trim();return Math.round(Number(out)/1048576);}catch{return null;}}
const samples=[];const counts={viewSwitches:0,communityOpens:0,modeToggles:0,searches:0,searchErrors:0};
async function sample(minute){await cdp.send('HeapProfiler.collectGarbage');const m=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));const backend=await (await fetch(base+'/api/metrics')).json();
 samples.push({minute,jsHeapMB:+(m.JSHeapUsedSize/1048576).toFixed(2),domNodes:m.Nodes,listeners:m.JSEventListeners,gpuProcessMB:gpuProcessMB(),backendRssMB:Math.round(backend.memory.rss/1048576),backendHeapMB:+(backend.memory.heapUsed/1048576).toFixed(1),...counts});console.log(JSON.stringify(samples.at(-1)));}
const slope=(key)=>{const pts=samples.filter(s=>s.minute>=2&&s[key]!=null);if(pts.length<3)return null;const n=pts.length,mx=pts.reduce((a,p)=>a+p.minute,0)/n,my=pts.reduce((a,p)=>a+p[key],0)/n;const num=pts.reduce((a,p)=>a+(p.minute-mx)*(p[key]-my),0),den=pts.reduce((a,p)=>a+(p.minute-mx)**2,0);return +(num/den).toFixed(3);};
const questions=['customer escalation about latency','GPU capacity planning','SSO SAML configuration','incident postmortem database outage','מה הנוהל לקליטת עובד חדש?'];
let stop=false;const searcher=(async()=>{let i=0;while(!stop){try{const r=await fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:questions[i++%questions.length],strategy:'hybrid'})});if(!r.ok)counts.searchErrors++;counts.searches++;}catch{counts.searchErrors++;}await new Promise(r=>setTimeout(r,2000));}})();
try{
 await page.goto(base);await page.locator('.spatial-canvas canvas').waitFor();await page.waitForTimeout(3000);await sample(0);
 const start=Date.now();let nextSample=1;
 while(Date.now()-start<minutes*60000){
  await page.getByRole('button',{name:/ספריית מסמכים/}).click();await page.locator('.document-grid article').first().waitFor();await page.getByRole('button',{name:/המוח הארגוני/}).click();counts.viewSwitches++;
  await page.locator('.graph-node-menu summary').click();const community=page.locator('.graph-node-menu button').filter({hasText:'קבוצת מסמכים'});const n=await community.count();
  if(n){await community.nth(counts.communityOpens%n).click();counts.communityOpens++;await page.locator('.map-trail').waitFor();await page.waitForTimeout(700);await page.getByRole('button',{name:/סקירת הקבוצות/}).click();await page.locator('.map-trail').waitFor({state:'detached'});}else await page.locator('.graph-node-menu summary').click();
  await page.getByRole('button',{name:'גרף דו־ממדי',exact:true}).click();await page.locator('.graph-canvas canvas').first().waitFor();await page.getByRole('button',{name:'גרף תלת־ממדי',exact:true}).click();await page.locator('.spatial-canvas canvas').waitFor();counts.modeToggles++;
  await page.waitForTimeout(500);
  if(Date.now()-start>=nextSample*60000){await sample(nextSample);nextSample++;}
 }
}finally{stop=true;await searcher;await browser.close();}
const report={base,minutes,samples,counts,errors,slopesPerMinute:{jsHeapMB:slope('jsHeapMB'),domNodes:slope('domNodes'),listeners:slope('listeners'),gpuProcessMB:slope('gpuProcessMB'),backendRssMB:slope('backendRssMB'),backendHeapMB:slope('backendHeapMB')},note:'Slopes are least-squares fits from minute 2 onward (after warm-up). A leak shows as a steady positive slope.'};
await mkdir('reports/performance',{recursive:true});await writeFile('reports/performance/soak.json',JSON.stringify(report,null,2));console.log(JSON.stringify({counts,errors,slopesPerMinute:report.slopesPerMinute},null,1));
