import {_electron as electron} from 'playwright';
import executablePath from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile=path.resolve('reports/system-audit/electron-profile-'+Date.now());await mkdir(profile,{recursive:true});const r={startedUTC:new Date().toISOString(),profile,checks:[]};let instance;
const env={...process.env,BRAIN_DESKTOP_USER_DATA:profile,BRAIN_DESKTOP_LEGACY_DATA:path.join(profile,'no-legacy')};delete env.ELECTRON_RUN_AS_NODE;delete env.BRAIN_PAUSE_BACKGROUND;delete env.RAG_EMBED_MODEL;
try{
 instance=await electron.launch({executablePath,args:[process.cwd()],env,timeout:60000});let page=await instance.firstWindow();await page.waitForURL('http://127.0.0.1:**',{timeout:60000});await page.locator('.graph-empty').waitFor();
 const prefs=await instance.evaluate(({BrowserWindow,app})=>{const w=BrowserWindow.getAllWindows()[0];const p=w.webContents.getLastWebPreferences();return {contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration,sandbox:p.sandbox,metrics:app.getAppMetrics()};});assert.equal(prefs.contextIsolation,true);assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.sandbox,true);r.memory=prefs.metrics;r.checks.push('Electron starts its packaged backend with renderer isolation and sandbox');
 await page.getByRole('textbox',{name:'חיפוש בגרף'}).fill('HR-001');await page.waitForFunction(()=>Number(document.querySelector('.spatial-graph')?.dataset.nodeCount)>0);await page.locator('.graph-node-menu summary').click();await page.locator('.graph-node-menu button').filter({hasText:'HR-001'}).click();await page.locator('.document-text').waitFor();r.checks.push('real 3D search and document selection inside Electron');
 const count=await page.evaluate(async()=>(await(await fetch('/api/state')).json()).totalDocuments);assert.equal(count,20);await instance.close();instance=undefined;
 instance=await electron.launch({executablePath,args:[process.cwd()],env,timeout:60000});page=await instance.firstWindow();await page.waitForURL('http://127.0.0.1:**',{timeout:60000});assert.equal(await page.evaluate(async()=>(await(await fetch('/api/state')).json()).totalDocuments),20);r.checks.push('20 documents persist after Electron close and reopen');r.status='passed';
}catch(error){r.status='failed-or-blocked';r.error=error.stack;process.exitCode=1;}finally{if(instance)await instance.close();r.finishedUTC=new Date().toISOString();await writeFile('reports/system-audit/electron.json',JSON.stringify(r,null,2));console.log(JSON.stringify({status:r.status,checks:r.checks,error:r.error},null,2));}
