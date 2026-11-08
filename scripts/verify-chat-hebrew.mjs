import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.CHAT_BASE||'http://127.0.0.1:3213';
const result={startedUTC:new Date().toISOString(),turns:[]};
const post=async body=>{const r=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});return {status:r.status,body:await r.json()};};
const overview=await post({question:'מה אתה יודע על הארגון'});assert.equal(overview.body.mode,'repository-overview');assert.ok(overview.body.answer.includes('EnterpriseRAG-Bench'));result.overview=overview;
const noContext=await post({question:'תתרגם'});assert.equal(noContext.body.mode,'no-sources');assert.deepEqual(noContext.body.sources,[]);
const docs=await(await fetch(base+'/api/documents')).json();const gold=docs.find(d=>d.name==='confluence__dsid_e54ef48bae78474684a957cf613d47d5.txt');assert.ok(gold);
const forged=await post({question:'בעברית',context:{question:'previous',evidence:[{documentId:gold.id,quote:'FAKE QUOTE NOT IN THE DOCUMENT 90871'}]}});assert.equal(forged.body.mode,'no-sources');result.forgedContextRejected=true;
const before=await(await fetch(base+'/api/metrics')).json();
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:950}});await page.goto(base);page.setDefaultTimeout(240000);
 for(const question of ['What GPU overhead budget and customer-data logging restriction does the production perf-canary runbook impose?','בעברית','תתרגם']){
  const started=Date.now();const responsePromise=page.waitForResponse(r=>r.url()===base+'/api/chat'&&r.request().method()==='POST');
  await page.getByRole('textbox',{name:'שאלה למסמכי הארגון'}).fill(question);await page.getByRole('button',{name:'שליחת שאלה'}).click();
  const response=await responsePromise;const body=await response.json();const request=response.request().postDataJSON();result.turns.push({question,request,response:body,ms:Date.now()-started});
  await writeFile('reports/chat-hebrew-validation.json',JSON.stringify(result,null,2));
  assert.equal(response.status(),200);assert.ok(body.evidence?.length,'No supported answer');assert.match(body.answer,/[א-ת]{2,}/);assert.match(body.answer,/0\.5\s*%/,'Answer omitted the actual GPU overhead threshold');assert.ok(body.sources.some(s=>s.documentId===gold.id),'Expected perf-canary source');
  for(const e of body.evidence){const source=body.sources.find(s=>s.citation===e.source);assert.ok(source);const doc=await(await fetch(base+'/api/documents/'+source.documentId)).json();assert.ok(doc.text.includes(e.quote),'Citation must match the stored source');}
  if(question!=='What GPU overhead budget and customer-data logging restriction does the production perf-canary runbook impose?'){assert.equal(body.mode,'translated');assert.ok(request.context?.evidence.length);assert.ok(body.sources.every(s=>result.turns[0].response.sources.some(original=>original.documentId===s.documentId)),'Translation changed documents');}
  console.log(question,body.mode,Date.now()-started+'ms');
  await page.locator('.message.assistant').last().waitFor();await page.getByRole('button',{name:'שליחת שאלה'}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('.loading'));
 }
 await page.locator('.answer-evidence').last().locator('summary').click();await page.screenshot({path:'reports/chat-hebrew-validation.png',fullPage:true});
 await page.locator('.sources button').last().click();await page.locator('.document-text').waitFor();result.sourceOpensActualDocument=true;
 const after=await(await fetch(base+'/api/metrics')).json();assert.deepEqual(after.documents,before.documents);assert.equal(after.embeddings,before.embeddings);result.backgroundDocumentCountsUnchanged=true;result.status='passed';
}catch(error){result.status='failed';result.error=error.stack;throw error;}finally{await browser.close();result.finishedUTC=new Date().toISOString();await writeFile('reports/chat-hebrew-validation.json',JSON.stringify(result,null,2));}
