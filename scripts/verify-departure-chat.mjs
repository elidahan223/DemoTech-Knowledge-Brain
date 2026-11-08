import {DatabaseSync,backup} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const label=process.env.CHECK_LABEL||'before',out=path.resolve('reports/departure-chat');await mkdir(out,{recursive:true});
const directory=path.resolve('repositories/departure-chat-'+Date.now());await mkdir(directory,{recursive:true});
const db=new DatabaseSync(path.resolve('repositories/DemoTech-Organization/brain.sqlite'),{readOnly:true});await backup(db,path.join(directory,'brain.sqlite'));db.close();
const calls=[],turns=[];let child;
const proxy=createServer(async(req,res)=>{const bytes=[];for await(const part of req)bytes.push(part);const raw=Buffer.concat(bytes).toString();let body={};try{body=JSON.parse(raw);}catch{}
try{const response=await fetch('http://127.0.0.1:11434'+req.url,{method:req.method,headers:{'Content-Type':'application/json'},...(req.method==='POST'?{body:raw}:{})});const text=await response.text();if(req.url==='/api/chat')calls.push({requestId:req.headers['x-brain-request-id'],messages:body.messages,content:JSON.parse(text).message?.content});res.writeHead(response.status,{'Content-Type':'application/json'});res.end(text);}catch(e){res.writeHead(502);res.end('{}');}});
try{await new Promise(r=>proxy.listen(0,'127.0.0.1',r));child=spawn(process.execPath,['build/server/index.mjs'],{windowsHide:true,stdio:'ignore',env:{...process.env,NODE_ENV:'production',PORT:'3232',BRAIN_DATA_DIR:directory,BRAIN_REPOSITORY_NAME:'DemoTech-Organization',BRAIN_SEED_DEMO:'0',BRAIN_PAUSE_BACKGROUND:'1',OLLAMA_URL:'http://127.0.0.1:'+proxy.address().port,RAG_EMBED_MODEL:'embeddinggemma:latest'}});
const base='http://127.0.0.1:3232';for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
let context;for(const question of ['מהו המבנה הארגוני של הארגון ?','מה התהליך שעובד עובר כאשר הוא מסיים את תפקידו','מה אתה יודע להגיד לי על הארגון','מי אחראי על הכספים בארגון','מה התהליך שצריך לבצע לעובד שעוזב את הארגון','אבל שעלתי על עזיבה']){
const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,context})});const result=await response.json();context=result.conversationContext||{question,evidence:[]};turns.push({question,status:response.status,result,calls:calls.filter(c=>c.requestId===response.headers.get('x-brain-request-id'))});console.log(JSON.stringify({question,mode:result.mode,answer:result.answer,sources:result.sources?.map(s=>s.title)}));}
}finally{if(child){const p=new Promise(r=>child.once('exit',r));child.kill();await p;}await new Promise(r=>proxy.close(r));await writeFile(path.join(out,label+'.json'),JSON.stringify({turns},null,2));}
const checks=turns.map((t,i)=>({question:t.question,passed:t.status===200&&t.result.answerKind==='ai'&&t.result.evidence?.length>0&&([1,4,5].includes(i)?t.result.sources?.some(s=>/HR-004|IT-003/.test(s.title))&&/HR-F09|ננעלות|נעילת|ציוד/.test(t.result.answer)&&!/HR-F01|קליטת|תחילת העבודה|הקמת חשבון/.test(t.result.answer):i===3?t.result.answer.includes('רונית לוי'):i===0?t.result.answer.includes('יעל ארז')&&t.result.answer.includes('מיה כהן'):t.result.answer.includes('ServiceDesk'))}));
await writeFile(path.join(out,label+'-checks.json'),JSON.stringify({checks,passed:checks.every(c=>c.passed)},null,2));assert.ok(checks.every(c=>c.passed),JSON.stringify(checks));
