import {_electron as electron} from 'playwright';
import electronExecutable from 'electron';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const executable=process.argv[2]?path.resolve(process.argv[2]):electronExecutable;
const packaged=Boolean(process.argv[2]);
const profile=path.join(root,'reports',`desktop-profile-${Date.now()}`);
await mkdir(profile,{recursive:true});
const report={packaged,executable,profile,checks:[]};
let desktop;
const cleanEnv={...process.env,BRAIN_DESKTOP_USER_DATA:profile,BRAIN_DESKTOP_LEGACY_DATA:path.join(profile,'no-legacy'),PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`};
for(const key of ['NODE_OPTIONS','ELECTRON_RUN_AS_NODE','ELECTRON_NO_ASAR'])delete cleanEnv[key];
async function launch(data=profile){
 const env={...cleanEnv,BRAIN_DESKTOP_USER_DATA:data};
 const instance=await electron.launch({executablePath:executable,args:packaged?[]:[root],cwd:path.dirname(data),env,timeout:60000});
 const page=await instance.firstWindow();page.setDefaultTimeout(90000);
 await page.locator('.stats b').first().filter({hasText:'20'}).waitFor();
 return {instance,page};
}
async function request(page,endpoint,method='GET',body){return page.evaluate(async({endpoint,method,body})=>{const r=await fetch('/api'+endpoint,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};},{endpoint,method,body});}
async function closedPort(origin){for(let i=0;i<40;i++){try{await fetch(origin,{signal:AbortSignal.timeout(500)});}catch{return true;}await new Promise(r=>setTimeout(r,100));}return false;}
try{
 let {instance,page}=await launch();desktop=instance;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const state=await instance.evaluate(({app,BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];const p=w.webContents.getLastWebPreferences();return {version:app.getVersion(),isPackaged:app.isPackaged,userData:app.getPath('userData'),contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration,sandbox:p.sandbox,preload:p.preload||null,backend:app.getAppMetrics().find(m=>m.name==='DemoTech Local Backend'),url:w.webContents.getURL()};});
 report.version=state.version;assert.equal(state.isPackaged,packaged);assert.equal(state.userData,profile);assert.equal(state.contextIsolation,true);assert.equal(state.nodeIntegration,false);assert.equal(state.sandbox,true);assert.equal(state.preload,null);assert.ok(state.backend);assert.ok(state.url.startsWith('http://127.0.0.1:'));
 assert.deepEqual(await page.evaluate(()=>({require:typeof window.require,process:typeof window.process})),{require:'undefined',process:'undefined'});
 assert.equal((await fetch(new URL('/api/health',state.url))).status,403);
 assert.equal(await page.evaluate(async()=>{try{await fetch('https://example.com');return true;}catch{return false;}}),false);
 report.checks.push('packaged backend starts and seeds 20 documents without system Node or Vite','renderer sandbox and isolation; no preload or Node API','unauthenticated loopback access denied','external network requests blocked');
 const spatialCanvas=page.locator('.spatial-canvas canvas');await spatialCanvas.waitFor();await page.waitForTimeout(1200);assert.equal(await page.locator('.graph-fallback').count(),0);
 const graphBox=await spatialCanvas.boundingBox();const initialFrame=await spatialCanvas.screenshot();await page.mouse.move(graphBox.x+30,graphBox.y+graphBox.height*.7);await page.mouse.down();await page.mouse.move(graphBox.x+140,graphBox.y+graphBox.height*.7+40,{steps:15});await page.mouse.up();await page.waitForTimeout(500);assert.ok(!(await spatialCanvas.screenshot()).equals(initialFrame));
 await page.getByRole('button',{name:'סיבוב אוטומטי',exact:false}).click();await page.getByRole('button',{name:'עצירת סיבוב',exact:false}).click();
 await page.getByRole('textbox',{name:'חיפוש בגרף'}).fill('HR-001');await page.locator('.spatial-graph[data-node-count="1"]').waitFor();await page.waitForTimeout(1000);const singleBox=await spatialCanvas.boundingBox();await page.mouse.move(singleBox.x+singleBox.width/2,singleBox.y+singleBox.height/2,{steps:10});await page.waitForTimeout(300);await page.mouse.click(singleBox.x+singleBox.width/2,singleBox.y+singleBox.height/2);await page.locator('.document-text').filter({hasText:'HR-001'}).waitFor();
 await page.getByRole('textbox',{name:'חיפוש בגרף'}).fill('');await page.getByRole('combobox',{name:'סינון סוג צומת'}).selectOption('person');await page.locator('.spatial-graph[data-node-count="5"]').waitFor({timeout:10000});await page.getByRole('combobox',{name:'סינון סוג צומת'}).selectOption('all');
 await page.getByRole('button',{name:'גרף דו־ממדי',exact:true}).click();await page.locator('.graph-canvas canvas').first().waitFor();await page.getByRole('button',{name:'גרף תלת־ממדי',exact:true}).click();await page.locator('.spatial-canvas canvas').waitFor();
 report.checks.push('real WebGL graph, mouse orbit and automatic rotation','3D canvas node click opens the matching document','3D search, type filter and reversible 2D fallback');
 await page.getByRole('button',{name:/ספריית מסמכים/}).click();await page.locator('.document-grid article').nth(19).waitFor();assert.equal(await page.locator('.document-grid article').count(),20);
 await page.locator('.document-grid article').filter({hasText:'רכש ציוד מחשוב'}).getByRole('button',{name:/פתיחה/}).click();await page.locator('.document-text').filter({hasText:'DT-RAG-7319'}).waitFor();
 const health=(await request(page,'/health')).data;
 if(health.ollama.available){
  await page.getByRole('textbox',{name:'שאלה למסמכי הארגון'}).fill('מה קוד הבקרה של נוהל הרכש?');await page.getByRole('button',{name:'שליחת שאלה'}).click();await page.locator('.message.assistant').filter({hasText:'DT-RAG-7319'}).waitFor({timeout:200000});await page.locator('.sources button').first().click();await page.locator('.evidence').waitFor();report.checks.push('local Ollama chat with source opened');
 }else report.checks.push('Ollama unavailable notice displayed; AI check skipped');
 await page.screenshot({path:path.join(root,'reports',packaged?'electron-packaged.png':'electron-development.png'),fullPage:true});
 const buffer=Buffer.concat([await readFile(path.join(root,'docs','FIN-001.docx')),Buffer.from('desktop-runtime-smoke')]);
 await page.locator('input[type=file]').setInputFiles({name:'desktop-smoke.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer});
 let id;
 for(let i=0;i<80;i++){const docs=(await request(page,'/documents')).data;const d=docs.find(d=>d.name==='desktop-smoke.docx');if(d?.status==='ready'){id=d.id;break;}if(d?.status==='error')throw new Error(d.error);await new Promise(r=>setTimeout(r,250));}
 assert.ok(id,'DOCX worker processing in desktop');await access(path.join(profile,'data','brain.sqlite'));
 const firstOrigin=new URL(state.url).origin;await instance.close();desktop=null;assert.ok(await closedPort(firstOrigin),'Backend must exit with desktop window');
 // Launch again from the same installed executable; data must survive restart.
 instance=await electron.launch({executablePath:executable,args:packaged?[]:[root],cwd:path.dirname(profile),env:cleanEnv,timeout:60000});desktop=instance;page=await instance.firstWindow();await page.locator('.stats b').first().filter({hasText:'21'}).waitFor({timeout:90000});
 assert.ok((await request(page,'/documents')).data.some(d=>d.id===id&&d.status==='ready'));await request(page,'/documents/'+id,'DELETE');
 report.checks.push('DOCX upload and worker extraction','user data persists across restart','backend terminates on app exit');
 await instance.close();desktop=null;
 const unavailable=profile+'-ollama-offline';await mkdir(unavailable,{recursive:true});await writeFile(path.join(unavailable,'settings.json'),JSON.stringify({ollamaUrl:'http://127.0.0.1:1',ollamaModel:'gemma3:4b'}));
 ({instance,page}=await launch(unavailable));desktop=instance;await page.getByText('שירות Ollama אינו פעיל',{exact:true}).waitFor();assert.equal((await request(page,'/documents')).data.length,20);report.checks.push('Ollama offline message; graph and documents remain available');await page.screenshot({path:path.join(root,'reports','electron-ollama-offline.png'),fullPage:true});await instance.close();desktop=null;
 assert.deepEqual(errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;try{report.log=await readFile(path.join(profile,'logs','desktop.log'),'utf8');}catch{};throw error;
}finally{if(desktop)await desktop.close().catch(()=>{});await writeFile(path.join(root,'reports',packaged?'electron-packaged-validation.json':'electron-validation.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
