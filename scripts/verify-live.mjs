import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:3210/api';
async function api(endpoint,options){const response=await fetch(base+endpoint,options);const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;}
const csv=await readFile('questions_and_answers.csv','utf8');
const report=[];
for(const line of csv.trim().split(/\r?\n/).slice(1)){
 const cells=(line.match(/("(?:[^"]|"")*"|[^,]+)(?:,|$)/g)||[]).map(c=>c.replace(/,$/,'').replace(/^"|"$/g,'').replaceAll('""','"'));
 const start=Date.now();const result=await api('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:cells[0]})});
 const item={question:cells[0],expected:cells[1],answer:result.answer,mode:result.mode,sourceDocs:result.sources.map(s=>s.documentId),milliseconds:Date.now()-start};report.push(item);console.log(JSON.stringify(item));assert.equal(result.mode,'ollama');assert.ok(result.sources.some(s=>cells[2].split(';').includes(s.documentId)));
}
const form=new FormData();form.append('files',new Blob([await readFile('docs/FIN-001.docx'),'integration-fixture']),'integration.docx');const uploaded=await api('/documents',{method:'POST',body:form});const id=uploaded[0].id;assert.ok(id.startsWith('DOC-'));
async function wait(){for(let i=0;i<100;i++){const d=await api('/documents/'+id);if(d.status==='ready')return d;if(d.status==='error')throw new Error(d.error);await new Promise(r=>setTimeout(r,200));}throw new Error('Job timeout');}
const doc=await wait();assert.ok(doc.text.includes('DT-RAG-7319'));
const replacement=new FormData();replacement.append('replaceId',id);replacement.append('files',new Blob([await readFile('docs/HR-002.docx'),'integration-fixture']),'replacement.docx');await api('/documents',{method:'POST',body:replacement});const updated=await wait();assert.ok(!updated.text.includes('DT-RAG-7319'));assert.ok(updated.text.includes('VPN'));
await api('/documents/'+id,{method:'DELETE'});const graph=await api('/graph');assert.ok(!graph.nodes.some(n=>n.id===id));assert.ok(!graph.edges.some(e=>e.documentId===id||e.source===id||e.target===id));
assert.equal((await fetch(base+'/documents',{method:'POST',headers:{Origin:'https://example.com'}})).status,403);
assert.equal((await fetch(base+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:1})})).status,400);
await mkdir('reports',{recursive:true});await writeFile('reports/live-validation.json',JSON.stringify({date:new Date().toISOString(),questions:report,uploadUpdateDelete:'passed',originProtection:'passed',inputValidation:'passed'},null,2));console.log('LIVE VALIDATION PASSED');
