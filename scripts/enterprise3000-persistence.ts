import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
process.env.BRAIN_DATA_DIR=path.resolve('repositories/Enterprise-3000');
process.env.BRAIN_REPOSITORY_NAME='Enterprise-3000';
process.env.BRAIN_SEED_DEMO='0';
process.env.RAG_EMBED_MODEL='embeddinggemma:latest';
const questions=JSON.parse(await readFile('test-data/enterprise-3000-questions.json','utf8')).filter((q:{id:string})=>['C01','C12','C18'].includes(q.id));
const before=[];
for(const q of questions){const response=await fetch('http://127.0.0.1:3213/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q.question}),signal:AbortSignal.timeout(300000)});if(!response.ok)throw Error('Live repository search failed');before.push(await response.json());}
const {db}=await import('../server/store.js');
const {loadVectors}=await import('../server/vectors.js');
const {searchSources}=await import('../server/rag.js');
try{
 const started=Date.now();await loadVectors();const loadMs=Date.now()-started;
 const results=[];
 for(let i=0;i<questions.length;i++){const sources=await searchSources(questions[i].question);const ids=(rows:{documentId:string}[])=>rows.map(s=>s.documentId);results.push({id:questions[i].id,liveDocumentIds:ids(before[i]),freshProcessDocumentIds:ids(sources),identicalRanking:JSON.stringify(ids(before[i]))===JSON.stringify(ids(sources))});}
 const report={checkedUTC:new Date().toISOString(),description:'A fresh Node process rebuilds its in-memory Orama index exclusively from the persisted SQLite vectors; no document embeddings are regenerated. The original backend remains running. This is an index rehydration test, not a full application restart.',documents:db.prepare('SELECT count(*) AS n FROM documents').get()?.n,embeddings:db.prepare('SELECT count(*) AS n FROM embeddings').get()?.n,loadMs,rssBytes:process.memoryUsage().rss,results};
 await writeFile('reports/enterprise3000/persistence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{db.close();}
