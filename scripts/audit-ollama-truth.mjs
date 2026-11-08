import {DatabaseSync,backup} from 'node:sqlite';
import {createServer} from 'node:http';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const out=path.resolve(process.env.AUDIT_OUTPUT_DIR||'reports/ollama-truth');await mkdir(out,{recursive:true});
const hash=text=>createHash('sha256').update(text).digest('hex');
const chat=async(base,question,context)=>{const started=performance.now();const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,context})});return {question,status:response.status,requestId:response.headers.get('X-Brain-Request-ID'),result:await response.json(),ms:performance.now()-started};};
if(process.env.AUDIT_PHASE==='before'){
 const log=path.join(process.env.LOCALAPPDATA,'Ollama/server.log');const health=await(await fetch('http://127.0.0.1:3213/api/health')).json();const tags=await(await fetch('http://127.0.0.1:11434/api/tags')).json();
 const direct=await(await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'gemma3:4b',stream:false,messages:[{role:'user',content:'Reply with only: OLLAMA_DIRECT_CHECK'}],options:{temperature:0,num_predict:30}})})).json();
 const turns=[];for(const question of ['מי אחראי על הכספים?','ספר לי על ServiceDesk']){const startUTC=new Date().toISOString(),before=(await readFile(log)).length;const turn=await chat('http://127.0.0.1:3213',question);const delta=(await readFile(log)).subarray(before).toString('utf8');turns.push({...turn,startUTC,endUTC:new Date().toISOString(),ollamaServiceHttpLines:delta.split(/\r?\n/).filter(line=>line.includes('[GIN]')&&/POST.*"\/api\/(chat|embed)"/.test(line))});console.log('before',turn.result.mode,'HTTP',turn.status);}
 await writeFile(path.join(out,'before.json'),JSON.stringify({health,installedModels:tags.models.map(m=>m.name),direct:{model:direct.model,content:direct.message?.content},turns},null,2));process.exit(0);
}
const report={started:new Date().toISOString(),buildHash:hash(await readFile('build/server/index.mjs')),turns:[],offline:[],trace:[],proxy:[]};let browser,child,proxy;
const live=new DatabaseSync(path.resolve('repositories/DemoTech-Organization/brain.sqlite'),{readOnly:true});
const snapshot=()=>Object.fromEntries(['documents','chunks','embeddings','nodes','edges'].map(table=>[table,hash(JSON.stringify(live.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))]));
report.productionBefore=snapshot();const data=path.resolve('repositories/ai-generation-check');await mkdir(data,{recursive:true});await backup(live,path.join(data,'brain.sqlite'));
const clean=text=>text.trim().replace(/\s*[([]E\d+(?:,\s*E\d+)*[)\]]|\[\d+(?:\.\d+)?\]|\bE\d+\b/g,'').replace(/\s+([.,])/g,'$1').trim();
async function stop(){if(child){const current=child;child=undefined;await new Promise(resolve=>{current.once('exit',resolve);current.kill();});}}
async function start(ollamaUrl,embeddings='embeddinggemma:latest'){
 child=spawn(process.execPath,['build/server/index.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:'3220',NODE_ENV:'production',BRAIN_DATA_DIR:data,BRAIN_REPOSITORY_NAME:'DemoTech-Organization',BRAIN_SEED_DEMO:'0',BRAIN_PAUSE_BACKGROUND:'1',BRAIN_TRACE_AI:'1',BRAIN_DEBUG_GENERATION:'0',OLLAMA_URL:ollamaUrl,RAG_EMBED_MODEL:embeddings}});
 let pending='';child.stdout.on('data',chunk=>{pending+=chunk.toString();let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);try{const event=JSON.parse(line);if(event.event)report.trace.push(event);}catch{}}});child.stderr.on('data',()=>{});
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Audit server exited');try{if((await fetch('http://127.0.0.1:3220/api/state')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Audit server not ready');
}
function inspect(turn){
 const calls=report.proxy.filter(p=>p.requestId===turn.requestId&&p.endpoint==='/api/chat');turn.ollamaCalls=calls;turn.modelCalled=calls.length>0;turn.modelContentReceived=calls.some(c=>Boolean(c.content));
 turn.retrievedExcerpts=calls.flatMap(c=>c.excerpts||[]);
 const final=turn.result;const generated=calls.flatMap(c=>{try{const parsed=JSON.parse(c.content);return parsed.statements||parsed.topics?.map(t=>({text:t.topic}))||parsed.responsibilities?.map(t=>({text:t.task}))||[];}catch{return [];}});
 turn.generatedStatements=generated.length;turn.acceptedStatements=final.evidence?.length||0;
 turn.allDisplayedStatementsFromModel=final.answerKind==='ai'&&Boolean(final.evidence?.length)?final.evidence.every(e=>generated.some(s=>typeof s.text==='string'&&clean(s.text)===e.text)):null;
 turn.quotes=(final.evidence||[]).map(e=>{const d=live.prepare('SELECT title,text FROM documents WHERE id=?').get(e.documentId);return {documentId:e.documentId,title:d?.title,text:e.text,quote:e.quote,exactQuote:Boolean(d&&d.text.includes(e.quote)),offsetsMatch:Boolean(d&&d.text.slice(e.startOffset,e.endOffset)===e.quote)};});
 const logged=report.trace.filter(t=>t.requestId===turn.requestId);turn.trace=logged;
 turn.rawOutputHashMatches=calls.length?calls.every(c=>logged.some(t=>t.event==='ollama.response'&&t.contentHash===hash(c.content||''))):null;
 turn.displayedAnswerHashMatches=logged.some(t=>t.event==='chat.answer'&&t.contentHash===hash(final.answer||''));
 if(final.answerKind==='ai'){assert.ok(turn.modelContentReceived);assert.ok(turn.allDisplayedStatementsFromModel);assert.ok(turn.rawOutputHashMatches);assert.ok(turn.displayedAnswerHashMatches);assert.ok(turn.quotes.every(q=>q.exactQuote&&q.offsetsMatch));}
 return turn;
}
try{
 proxy=createServer(async(req,res)=>{const started=performance.now();const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();let body={};try{body=JSON.parse(raw);}catch{}
  const event={requestId:req.headers['x-brain-request-id']||null,endpoint:req.url,model:body.model};report.proxy.push(event);
  try{const upstream=await fetch('http://127.0.0.1:11434'+req.url,{method:req.method,headers:{'Content-Type':'application/json'},...(req.method==='POST'?{body:raw}:{})});const bytes=await upstream.text();event.httpStatus=upstream.status;event.ms=performance.now()-started;
   if(req.url==='/api/chat'){const result=JSON.parse(bytes);event.responseModel=result.model;event.content=result.message?.content;const prompt=(body.messages||[]).map(m=>m.content).join('\n');event.excerpts=[...prompt.matchAll(/\[(E\d+)\] Document: ([^\n]+)\n([\s\S]*?)(?=\n\n\[E\d+\] Document: |$)/g)].map(m=>({id:m[1],title:m[2],text:m[3]}));}
   res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(bytes);
  }catch{event.httpStatus=null;res.writeHead(502);res.end('{}');}
 });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const proxyUrl='http://127.0.0.1:'+proxy.address().port;await start(proxyUrl);
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:3220');
 const question='מי אחראי על הכספים?';await page.getByRole('textbox',{name:'שאלה למסמכי הארגון'}).fill(question);const wait=page.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST');await page.getByRole('button',{name:'שליחת שאלה'}).click();const response=await wait;const body=await response.json();await page.waitForFunction(text=>document.querySelector('.message.assistant>div')?.textContent===text,body.answer);const visible=await page.locator('.message.assistant>div').first().textContent();
 report.browser={question,visibleText:visible,apiText:body.answer,exactMatch:visible===body.answer};assert.equal(visible,body.answer);report.turns.push(inspect({question,status:response.status(),requestId:response.headers()['x-brain-request-id'],result:body,fromBrowser:true}));await page.screenshot({path:path.join(out,'actual-chat.png'),fullPage:true});
 for(const q of ['ומה היא עושה?','מה הארגון עושה?','מה קוד הבקרה של נוהל הרכש?','ספר לי על ServiceDesk','על מה המסמכים מדברים?','מה היו ההכנסות של DemoTech בשנת 2025?','מה מצב ZQX-UNSEEN-90871?']){const turn=inspect(await chat('http://127.0.0.1:3220',q,q==='ומה היא עושה?'?body.conversationContext:undefined));report.turns.push(turn);console.log('audited',turn.result.mode,'calls',turn.ollamaCalls.length,'accepted',turn.acceptedStatements,'generated',turn.generatedStatements);}
 const count=report.proxy.length;const search=await fetch('http://127.0.0.1:3220/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'ServiceDesk',strategy:'lexical'})});report.lexicalSearch={status:search.status,kind:search.headers.get('X-Brain-Response-Kind'),items:(await search.json()).length,modelCalls:report.proxy.length-count};assert.equal(report.lexicalSearch.modelCalls,0);assert.equal(report.lexicalSearch.kind,'document-search');
 await stop();const dead=createServer();await new Promise(r=>dead.listen(0,'127.0.0.1',r));const deadUrl='http://127.0.0.1:'+dead.address().port;await new Promise(r=>dead.close(r));await start(deadUrl);
 for(const q of ['מה הארגון עושה?','מי אחראי על הכספים?']){const turn=await chat('http://127.0.0.1:3220',q);report.offline.push({...turn,trace:report.trace.filter(t=>t.requestId===turn.requestId)});assert.equal(turn.status,503);assert.equal(turn.result.code,'OLLAMA_UNAVAILABLE');assert.equal(turn.result.answer,undefined);assert.equal(turn.result.answerKind,'error');console.log('offline HTTP',turn.status,turn.result.code);}
 await page.reload();await page.getByRole('textbox',{name:'שאלה למסמכי הארגון'}).fill('מה הארגון עושה?');await page.getByRole('button',{name:'שליחת שאלה'}).click();await page.getByRole('alert').filter({hasText:'Ollama'}).waitFor();report.offlineBrowser={alert:await page.getByRole('alert').innerText(),assistantMessages:await page.locator('.message.assistant').count()};assert.equal(report.offlineBrowser.assistantMessages,0);await page.screenshot({path:path.join(out,'offline-error.png'),fullPage:true});
 report.status='passed';report.transportChecksPassed=true;report.answerQualityRequiresManualReview=true;
}catch(error){report.status='failed';report.error=error.stack;throw error;}
finally{await browser?.close();await stop();if(proxy)await new Promise(r=>proxy.close(r));report.productionAfter=snapshot();report.productionUnchanged=JSON.stringify(report.productionBefore)===JSON.stringify(report.productionAfter);live.close();report.finished=new Date().toISOString();await writeFile(path.join(out,'audit.json'),JSON.stringify(report,null,2));await writeFile(path.join(out,'metadata-only.jsonl'),report.trace.map(t=>JSON.stringify(t)).join('\n')+'\n');}
