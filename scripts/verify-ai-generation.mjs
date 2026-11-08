import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
const directory=path.resolve('repositories/ai-generation-check');await mkdir(directory,{recursive:true});
const live=new DatabaseSync(path.resolve('repositories/DemoTech-Organization/brain.sqlite'),{readOnly:true});await backup(live,path.join(directory,'brain.sqlite'));live.close();
const child=spawn(process.execPath,['build/server/index.mjs'],{windowsHide:true,stdio:['ignore','ignore','inherit'],env:{...process.env,BRAIN_DEBUG_GENERATION:'1',PORT:'3220',NODE_ENV:'production',BRAIN_DATA_DIR:directory,BRAIN_REPOSITORY_NAME:'DemoTech-Organization',BRAIN_SEED_DEMO:'0',BRAIN_PAUSE_BACKGROUND:'1',RAG_EMBED_MODEL:'embeddinggemma:latest'}});
const base='http://127.0.0.1:3220',turns=[];let context;
try{
 for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 for(const [question,expected] of [['מה הארגון עושה','ServiceDesk'],['אוקי מי אחראי על הכספים','רונית'],['מה הנושא של הקבצים',null],['מי פותח את בקשת הקליטה לעובד חדש?','מיה'],['מה קוד הבקרה של נוהל הרכש?','DT-RAG-7319'],['לא תשובה טובה','DT-RAG-7319']]){
  const started=performance.now();const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,context})});const result=await response.json();turns.push({question,result,ms:performance.now()-started});console.log(question,result.mode,result.answer);assert.equal(response.status,200);assert.equal(result.generation?.provider,'ollama');assert.ok(result.generation?.modelCalls>=2);assert.equal(result.mode,'ollama');if(expected)assert.ok(result.answer.includes(expected));
  if(question==='מה הנושא של הקבצים'){assert.equal(result.coverage.eligibleDocuments,30);assert.equal(result.coverage.contextDocuments,30);}
  for(const e of result.evidence){const doc=await(await fetch(base+'/api/documents/'+e.documentId)).json();assert.ok(doc.text.includes(e.quote));assert.equal(doc.text.slice(e.startOffset,e.endOffset),e.quote);}
  context=result.conversationContext;
 }
}finally{child.kill();await mkdir('reports/ai-generation',{recursive:true});await writeFile('reports/ai-generation/validation.json',JSON.stringify({turns,realOllama:true,isolatedRepository:directory},null,2));}
