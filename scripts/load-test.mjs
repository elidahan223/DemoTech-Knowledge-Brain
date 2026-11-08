// Graded load test with the real Enterprise documents (test-data/enterprise-3000), each size in an isolated
// temporary repository. Nothing is written to the DemoTech or Enterprise-3000 repositories.
// Per size: upload through the HTTP API in UI-sized batches, background ingestion with real local embeddings,
// API latency, search latency/recall, UI profile, then a hard kill (crash) + restart persistence check.
// Usage: node scripts/load-test.mjs [sizes=20,500,1000] [--crash-at=500] [--port=3220]
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd();const source=path.join(root,'test-data','enterprise-3000');
const sizes=(process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'20,500,1000').split(',').map(Number);
const crashAt=Number(process.argv.find(a=>a.startsWith('--crash-at='))?.split('=')[1]||500);const port0=Number(process.argv.find(a=>a.startsWith('--port='))?.split('=')[1]||3220);
const manifest=(await readFile(path.join(source,'_manifest.jsonl'),'utf8')).trim().split('\n').map(l=>JSON.parse(l));
const byType=new Map();for(const m of manifest){if(!byType.has(m.source_type))byType.set(m.source_type,[]);byType.get(m.source_type).push(m);}
// Round-robin across the 9 source types; the 22 evaluation documents are included first so recall can be measured.
const questions=JSON.parse(await readFile(path.join(root,'test-data','enterprise-3000-questions.json'),'utf8'));
function pick(n){const gold=questions.filter(q=>q.file).map(q=>manifest.find(m=>m.file===q.file)).filter(Boolean);const chosen=new Map(gold.slice(0,Math.min(n,gold.length)).map(m=>[m.file,m]));const lists=[...byType.values()].map(l=>[...l]);for(let i=0;chosen.size<n;i++){const list=lists[i%lists.length];const next=list.shift();if(next&&!chosen.has(next.file))chosen.set(next.file,next);if(lists.every(l=>!l.length))break;}return [...chosen.values()];}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const stats=a=>{const s=[...a].sort((x,y)=>x-y);const q=p=>s.length?+s[Math.min(s.length-1,Math.floor(p*s.length))].toFixed(1):null;return {n:s.length,p50:q(.5),p95:q(.95),max:s.length?+s.at(-1).toFixed(1):null};};
function run(cmd,args){return new Promise((resolve,reject)=>{const c=spawn(cmd,args,{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});let out='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>out+=d);c.on('exit',code=>code===0?resolve(out):reject(new Error(`${args.join(' ')} exited ${code}: ${out.slice(-800)}`)));});}
async function startServer(dir,port,name){
 const t=performance.now();const child=spawn(process.execPath,[path.join(root,'build/server/index.mjs')],{cwd:root,stdio:['ignore','ignore','pipe'],windowsHide:true,env:{...process.env,NODE_ENV:'production',PORT:String(port),BRAIN_DATA_DIR:dir,BRAIN_REPOSITORY_NAME:name,BRAIN_SEED_DEMO:'0',RAG_EMBED_MODEL:'embeddinggemma:latest',BRAIN_PAUSE_BACKGROUND:''}});
 let stderr='';child.stderr.on('data',d=>stderr+=d);
 for(;;){if(child.exitCode!==null)throw new Error('server exited: '+stderr.slice(-500));try{const r=await fetch(`http://127.0.0.1:${port}/api/state`);if(r.ok)break;}catch{}await sleep(100);}
 return {child,readyMs:Math.round(performance.now()-t)};
}
async function kill(child){if(child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await done;}
async function fingerprint(base){const docs=[];for(let page=0;;page++){const r=await (await fetch(`${base}/api/library?limit=100&page=${page}`)).json();docs.push(...r.items.map(d=>`${d.id}|${d.name}|${d.status}|${d.characters}`));if(docs.length>=r.total)break;}const m=await (await fetch(base+'/api/metrics')).json();return {documents:docs.length,hash:createHash('sha256').update(docs.sort().join('\n')).digest('hex'),chunks:m.chunks,embeddings:m.embeddings,vectorsInMemory:m.embeddingStats.vectors,edges:m.edges.reduce((s,e)=>s+e.count,0)};}
async function time(base,url,reps=8){const ms=[];let bytes=0;for(let i=0;i<reps;i++){const t=performance.now();const r=await fetch(base+url);const text=await r.text();ms.push(performance.now()-t);bytes=text.length;}return {...stats(ms),kilobytes:+(bytes/1024).toFixed(1)};}
const summary=[];
for(const [index,n] of sizes.entries()){
 const port=port0+index;const base=`http://127.0.0.1:${port}`;const dir=await mkdtemp(path.join(tmpdir(),`demotech-load-${n}-`));const name=`LoadTest-${n}`;
 const report={documents:n,repository:dir,startedUTC:new Date().toISOString()};console.log(`\n=== ${n} documents ===`);
 let {child,readyMs}=await startServer(dir,port,name);report.coldStartMs=readyMs;
 try{
  const files=pick(n);report.sourceBytes=files.reduce((s,f)=>s+f.file_bytes,0);report.types=Object.fromEntries([...new Set(files.map(f=>f.source_type))].map(t=>[t,files.filter(f=>f.source_type===t).length]));
  // Upload exactly like the UI: batches of 20 files.
  const t0=performance.now();let accepted=0,duplicates=0,failed=0;
  for(let i=0;i<files.length;i+=20){const form=new FormData();for(const f of files.slice(i,i+20))form.append('files',new Blob([await readFile(path.join(source,f.file))]),f.file);const r=await fetch(base+'/api/documents',{method:'POST',body:form});const receipts=await r.json();for(const x of receipts){if(x.error)failed++;else if(x.duplicate)duplicates++;else accepted++;}}
  report.upload={ms:Math.round(performance.now()-t0),accepted,duplicates,failed,requests:Math.ceil(files.length/20)};
  let peakRss=0,crashed=false;const ingestStart=performance.now();
  for(;;){
   const s=await (await fetch(base+'/api/jobs/summary')).json();const m=await (await fetch(base+'/api/metrics')).json();peakRss=Math.max(peakRss,m.memory.rss);
   if(n===crashAt&&!crashed&&(s.counts.done||0)>=n*.3){
    // Crash in the middle of ingestion: hard kill, restart, the queue must resume without loss or duplicates.
    report.crash={atDone:s.counts.done,atMs:Math.round(performance.now()-ingestStart)};await kill(child);({child,readyMs}=await startServer(dir,port,name));report.crash.restartReadyMs=readyMs;crashed=true;continue;
   }
   if(!s.remaining)break;await sleep(1000);
  }
  report.ingest={ms:Math.round(performance.now()-ingestStart),docsPerMinute:+(n/((performance.now()-ingestStart)/60000)).toFixed(1),peakBackendRssMB:Math.round(peakRss/1048576)};
  const state=await (await fetch(base+'/api/state')).json();const jobs=await (await fetch(base+'/api/jobs/summary')).json();
  report.integrity={totalDocuments:state.totalDocuments,ready:state.readyDocuments,errors:jobs.counts.error||0,lost:n-state.totalDocuments,doneJobs:jobs.counts.done||0};
  const metrics=await (await fetch(base+'/api/metrics')).json();report.index={chunks:metrics.chunks,embeddings:metrics.embeddings,vectorsInMemory:metrics.embeddingStats.vectors,vectorIndexMB:+(metrics.embeddingStats.indexBytes/1048576).toFixed(1),embeddingMsPerChunk:+(metrics.embeddingStats.providerMs/Math.max(1,metrics.embeddingStats.inputs)).toFixed(1),backendRssMB:Math.round(metrics.memory.rss/1048576),backendHeapMB:Math.round(metrics.memory.heapUsed/1048576)};
  // Explicit graph extraction (background graph jobs), timed.
  const g0=performance.now();await fetch(base+'/api/graph/rebuild',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'explicit'})});
  for(;;){const m=await (await fetch(base+'/api/metrics')).json();if(!m.graphJobs.some(j=>j.status==='queued'||j.status==='processing'))break;await sleep(500);}
  const after=await (await fetch(base+'/api/state')).json();report.graph={ms:Math.round(performance.now()-g0),nodes:after.totalNodes,edges:after.totalEdges};
  const anyDoc=(await (await fetch(base+'/api/library?limit=1')).json()).items[0].id;const group=(await (await fetch(base+'/api/map')).json()).nodes.find(x=>x.type==='community')?.group;
  report.api={state:await time(base,'/api/state'),libraryPage:await time(base,'/api/library?page=0&limit=100'),mapInitial:await time(base,'/api/map'),mapGroup:group?await time(base,`/api/map?group=${encodeURIComponent(group)}&limit=80`):null,nodeDetails:await time(base,`/api/nodes/${anyDoc}`),legacyFullGraph:await time(base,'/api/graph',3),legacyFullDocuments:await time(base,'/api/documents',3)};
  await run(process.execPath,['scripts/bench-search.mjs',`load-${n}`,base,'--rounds=2']);report.search=JSON.parse(await readFile(`reports/performance/search-load-${n}.json`,'utf8'));
  await run(process.execPath,['scripts/profile-ui.mjs',`ui-load-${n}`,base,'--cycles=5','--idle=10',...(n>=500?['--dense']:[])]);const ui=JSON.parse(await readFile(`reports/performance/ui-load-${n}.json`,'utf8'));
  report.ui={interfaceCanvasMs:ui.interfaceCanvasMs,graphReadyMs:ui.graphReadyMs,nodes:ui.nodeCount,idleCpuPercent:ui.phases.idle?.cpuBusyPercent,rotateFps:ui.phases.autoRotate?.fps,dragFps:ui.phases.orbitDrag?.fps,dense:ui.dense||null,denseRotateFps:ui.phases.denseAutoRotate?.fps??null,denseDragFps:ui.phases.denseOrbitDrag?.fps??null,viewRoundTripMs:ui.viewCycles?.roundTripMs,longTasksOver200ms:ui.totalLongTasks?.over200ms,maxLongTaskMs:ui.totalLongTasks?.maxMs,heapGrowthMB:ui.memoryAfterCycles?.heapGrowthMB,errors:ui.errors};
  // Persistence: hard kill (no graceful shutdown) and restart; everything must be identical.
  const before=await fingerprint(base);await kill(child);({child,readyMs}=await startServer(dir,port,name));
  const firstSearch=performance.now();await fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'customer escalation about latency',strategy:'hybrid'})});const firstSearchMs=Math.round(performance.now()-firstSearch);
  const afterRestart=await fingerprint(base);report.persistence={restartReadyMs:readyMs,firstHybridSearchAfterRestartMs:firstSearchMs,before,after:afterRestart,identical:JSON.stringify(before)===JSON.stringify(afterRestart)};
 }catch(error){report.error=String(error.stack||error);console.error(error);}finally{await kill(child);report.finishedUTC=new Date().toISOString();await mkdir('reports/performance',{recursive:true});await writeFile(`reports/performance/load-${n}.json`,JSON.stringify(report,null,2));await rm(dir,{recursive:true,force:true}).catch(()=>{});}
 summary.push(report);console.log(JSON.stringify({n,upload:report.upload,ingest:report.ingest,integrity:report.integrity,crash:report.crash,persistence:report.persistence&&{identical:report.persistence.identical,restartReadyMs:report.persistence.restartReadyMs},search:report.search&&{lexicalP50:report.search.lexical.clientMs.p50,hybridP50:report.search.hybrid.clientMs.p50,hybridP95:report.search.hybrid.clientMs.p95,hybridRecall:report.search.hybrid.recallAt6,lexicalRecall:report.search.lexical.recallAt6},ui:report.ui,error:report.error},null,1));
}
await writeFile('reports/performance/load-summary.json',JSON.stringify(summary.map(r=>({documents:r.documents,coldStartMs:r.coldStartMs,upload:r.upload,ingest:r.ingest,integrity:r.integrity,crash:r.crash,index:r.index,graph:r.graph,api:r.api,search:r.search&&{lexical:r.search.lexical,hybrid:r.search.hybrid,under1sPercent:r.search.under1sPercent},ui:r.ui,persistence:r.persistence&&{identical:r.persistence.identical,restartReadyMs:r.persistence.restartReadyMs,firstHybridSearchAfterRestartMs:r.persistence.firstHybridSearchAfterRestartMs},error:r.error})),null,2));
