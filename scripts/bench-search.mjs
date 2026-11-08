// Search latency and retrieval quality against a running server. Search time is measured separately from
// Ollama answer generation (no /api/chat calls here). Breakdown comes from the Server-Timing header.
// Usage: node scripts/bench-search.mjs <label> [base] [--rounds=2]
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const label=process.argv[2]||'search',base=process.argv[3]&&!process.argv[3].startsWith('--')?process.argv[3]:'http://127.0.0.1:3213';
const rounds=Number(process.argv.find(a=>a.startsWith('--rounds='))?.split('=')[1]||2);
const cases=JSON.parse(await readFile('test-data/enterprise-3000-questions.json','utf8'));
const generic=['How do customers rotate Hosted API keys?','incident postmortem database outage','pricing discussion with enterprise customer','quarterly roadmap planning meeting','SSO SAML configuration','onboarding checklist for new engineers','GPU capacity planning','customer escalation about latency','מה הנוהל לקליטת עובד חדש?','מי מאשר רכישת ציוד?'];
const stats=a=>{const s=[...a].sort((x,y)=>x-y);const q=p=>s.length?+s[Math.min(s.length-1,Math.floor(p*s.length))].toFixed(1):null;return {n:s.length,p50:q(.5),p95:q(.95),max:s.length?+s.at(-1).toFixed(1):null};};
async function idOf(file){const r=await (await fetch(`${base}/api/library?limit=5&search=${encodeURIComponent(file)}`)).json();return r.items.find(d=>d.name===file)?.id;}
const gold=new Map();for(const c of cases)if(c.file)gold.set(c.id,await idOf(c.file));
const timings={lexical:{},hybrid:{}};const recall={lexical:[],hybrid:[]};const clientMs={lexical:[],hybrid:[]};
for(let round=0;round<rounds;round++)for(const strategy of ['lexical','hybrid'])for(const q of [...cases.map(c=>({id:c.id,question:c.question})),...generic.map((question,i)=>({id:'G'+i,question}))]){
 const t=performance.now();const r=await fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q.question,strategy})});const body=await r.json();clientMs[strategy].push(performance.now()-t);
 if(!r.ok)throw new Error(`${strategy} ${r.status} ${JSON.stringify(body)}`);
 for(const part of (r.headers.get('server-timing')||'').split(',')){const m=part.trim().match(/^(\w+);dur=([\d.]+)/);if(m)(timings[strategy][m[1]]??=[]).push(Number(m[2]));}
 if(round===0&&gold.get(q.id))recall[strategy].push(body.some(s=>s.documentId===gold.get(q.id)));
}
const state=await (await fetch(base+'/api/state')).json();const metrics=await (await fetch(base+'/api/metrics')).json();
const report={label,base,measuredUTC:new Date().toISOString(),documents:state.totalDocuments,readyDocuments:state.readyDocuments,chunks:metrics.chunks,vectors:metrics.embeddingStats?.vectors,backendRssMB:Math.round(metrics.memory.rss/1048576),backendHeapMB:Math.round(metrics.memory.heapUsed/1048576),
 lexical:{clientMs:stats(clientMs.lexical),server:Object.fromEntries(Object.entries(timings.lexical).map(([k,v])=>[k,stats(v)])),recallAt6:recall.lexical.length?+(recall.lexical.filter(Boolean).length/recall.lexical.length).toFixed(3):null,goldQuestions:recall.lexical.length},
 hybrid:{clientMs:stats(clientMs.hybrid),server:Object.fromEntries(Object.entries(timings.hybrid).map(([k,v])=>[k,stats(v)])),recallAt6:recall.hybrid.length?+(recall.hybrid.filter(Boolean).length/recall.hybrid.length).toFixed(3):null,goldQuestions:recall.hybrid.length},
 under1sPercent:+(100*[...clientMs.lexical,...clientMs.hybrid].filter(x=>x<1000).length/(clientMs.lexical.length+clientMs.hybrid.length)).toFixed(1)};
await mkdir('reports/performance',{recursive:true});await writeFile(`reports/performance/search-${label}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,1));
