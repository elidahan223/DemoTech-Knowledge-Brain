// UI performance profile against a running production build (no mock data).
// Usage: node scripts/profile-ui.mjs <label> [base] [--cycles=N]
// Measures: interface readiness, idle CPU/frames, FPS while rotating and while orbit-dragging, long tasks,
// API bytes during an idle minute (polling cost), JS heap and DOM nodes across view switches (leak check).
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const label=process.argv[2]||'run',base=process.argv[3]&&!process.argv[3].startsWith('--')?process.argv[3]:'http://127.0.0.1:3213';
const cycles=Number(process.argv.find(a=>a.startsWith('--cycles='))?.split('=')[1]||8);const idleSeconds=Number(process.argv.find(a=>a.startsWith('--idle='))?.split('=')[1]||30);
const out='reports/performance';await mkdir(out,{recursive:true});
const report={label,base,startedUTC:new Date().toISOString(),errors:[],phases:{}};
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--ignore-gpu-blocklist','--enable-gpu-rasterization','--use-angle=d3d11']});
const stats=a=>{const s=[...a].sort((x,y)=>x-y);const q=p=>s.length?s[Math.min(s.length-1,Math.floor(p*s.length))]:null;return {n:s.length,median:q(.5),p95:q(.95),max:s.at(-1)??null};};
try{
 const page=await browser.newPage({viewport:{width:1500,height:950}});const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 await page.addInitScript(()=>{window.__perf={longTasks:[],frames:[]};new PerformanceObserver(list=>window.__perf.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});let last;const frame=now=>{if(last!==undefined)window.__perf.frames.push([now,now-last]);last=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);});
 let bytes=0,requests=0;page.on('response',async r=>{if(!r.url().includes('/api/'))return;requests++;try{bytes+=(await r.body()).length;}catch{}});
 page.on('pageerror',e=>report.errors.push(e.message));
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const t0=performance.now();await page.goto(base);await page.locator('.spatial-graph canvas').first().waitFor({timeout:90000});report.interfaceCanvasMs=+(performance.now()-t0).toFixed(0);
 await page.waitForFunction(()=>Number(document.querySelector('.spatial-graph')?.getAttribute('data-node-count'))>0,null,{timeout:60000}).catch(()=>{});
 report.graphReadyMs=+(performance.now()-t0).toFixed(0);report.nodeCount=Number(await page.locator('.spatial-graph').getAttribute('data-node-count'));
 report.webgl=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';});
 await page.waitForTimeout(4000);
 const window_=async(name,seconds,action)=>{const m0=await metrics();const f0=await page.evaluate(()=>performance.now());const l0=await page.evaluate(()=>window.__perf.longTasks.length);if(action)await action();else await page.waitForTimeout(seconds*1000);const m1=await metrics();const f1=await page.evaluate(()=>performance.now());
  const frames=await page.evaluate(([a,b])=>window.__perf.frames.filter(([t])=>t>=a&&t<=b).map(([,d])=>d),[f0,f1]);const long=await page.evaluate(n=>window.__perf.longTasks.slice(n).map(t=>t.duration),l0);const wall=(f1-f0)/1000;
  report.phases[name]={seconds:+wall.toFixed(2),fps:+(frames.length/wall).toFixed(1),frameMs:stats(frames),cpuBusyPercent:+((m1.TaskDuration-m0.TaskDuration)/wall*100).toFixed(1),scriptMs:+((m1.ScriptDuration-m0.ScriptDuration)*1000).toFixed(0),longTasks:long.length,maxLongTaskMs:long.length?Math.max(...long):0};};
 await window_('idle',8);
 const rotate=page.getByRole('button',{name:/סיבוב אוטומטי/});await rotate.click();await window_('autoRotate',8);await page.getByRole('button',{name:/עצירת סיבוב/}).click();
 const box=await page.locator('.spatial-canvas').boundingBox();
 await window_('orbitDrag',0,async()=>{await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();for(let i=0;i<120;i++){await page.mouse.move(box.x+box.width/2+Math.sin(i/12)*220,box.y+box.height/2+Math.cos(i/15)*90);await page.waitForTimeout(16);}await page.mouse.up();});
 bytes=0;requests=0;await window_('idleNetwork',idleSeconds);report.idleApi={seconds:idleSeconds,requests,kilobytes:+(bytes/1024).toFixed(1)};
 await cdp.send('HeapProfiler.enable');await cdp.send('HeapProfiler.collectGarbage');const before=await metrics();report.memoryLoaded={jsHeapMB:+(before.JSHeapUsedSize/1048576).toFixed(1),domNodes:before.Nodes,listeners:before.JSEventListeners};
 const trips=[];for(let i=0;i<cycles;i++){const t=performance.now();await page.getByRole('button',{name:/ספריית מסמכים/}).click();await page.locator('.document-grid article').first().waitFor();await page.getByRole('button',{name:/המוח הארגוני/}).click();await page.locator('.spatial-graph canvas').first().waitFor();await page.waitForFunction(()=>Number(document.querySelector('.spatial-graph')?.getAttribute('data-node-count'))>0);trips.push(+(performance.now()-t).toFixed(0));await page.waitForTimeout(250);}
 await cdp.send('HeapProfiler.collectGarbage');const afterCycles=await metrics();report.viewCycles={roundTripMs:stats(trips),all:trips};
 report.memoryAfterCycles={jsHeapMB:+(afterCycles.JSHeapUsedSize/1048576).toFixed(1),domNodes:afterCycles.Nodes,listeners:afterCycles.JSEventListeners,heapGrowthMB:+((afterCycles.JSHeapUsedSize-before.JSHeapUsedSize)/1048576).toFixed(1)};
 if(process.argv.includes('--dense')){
  // Dense scenario: open the largest community and load more until ~250 nodes are drawn.
  const nodesShown=()=>page.locator('.spatial-graph').getAttribute('data-node-count').then(Number);const t=performance.now();
  await page.locator('.graph-node-menu summary').click();const preferred=page.locator('.graph-node-menu button',{hasText:'confluence'});await (await preferred.count()?preferred.first():page.locator('.graph-node-menu button').first()).click();
  await page.waitForFunction(()=>Number(document.querySelector('.spatial-graph')?.getAttribute('data-node-count'))>40,null,{timeout:30000});
  for(let i=0;i<4;i++){const more=page.getByRole('button',{name:'טעינת עוד'});if(!await more.count())break;const before=await nodesShown();await more.click();await page.waitForFunction(n=>Number(document.querySelector('.spatial-graph')?.getAttribute('data-node-count'))>n,before,{timeout:30000}).catch(()=>{});}
  report.dense={nodes:await nodesShown(),openMs:+(performance.now()-t).toFixed(0),lastLayoutWorkerMs:Number(await page.locator('.spatial-graph').getAttribute('data-layout-ms'))};
  await page.waitForTimeout(2500);await window_('denseIdle',5);
  await page.getByRole('button',{name:/סיבוב אוטומטי/}).click();await window_('denseAutoRotate',8);await page.getByRole('button',{name:/עצירת סיבוב/}).click();
  await window_('denseOrbitDrag',0,async()=>{await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();for(let i=0;i<120;i++){await page.mouse.move(box.x+box.width/2+Math.sin(i/12)*220,box.y+box.height/2+Math.cos(i/15)*90);await page.waitForTimeout(16);}await page.mouse.up();});
  await page.screenshot({path:`${out}/${label}-dense.png`});
 }
 report.totalLongTasks=await page.evaluate(()=>({count:window.__perf.longTasks.length,maxMs:Math.max(0,...window.__perf.longTasks.map(t=>t.duration)),over200ms:window.__perf.longTasks.filter(t=>t.duration>200).length}));
 await page.screenshot({path:`${out}/${label}.png`});
}catch(error){report.errors.push(String(error.stack||error));process.exitCode=1;}finally{await browser.close();report.finishedUTC=new Date().toISOString();await writeFile(`${out}/${label}.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,1));
