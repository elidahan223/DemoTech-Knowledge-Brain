import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {writeFile,readFile} from 'node:fs/promises';
const root=process.cwd();
const executable=path.join(process.env.LOCALAPPDATA,'Programs','DemoTech Knowledge Brain','DemoTech Knowledge Brain.exe');
const expectedRoot=path.join(process.env.APPDATA,'DemoTech Knowledge Brain');
const original=new DatabaseSync(path.join(root,'data','brain.sqlite'),{readOnly:true});
const expected=original.prepare('SELECT id,title FROM documents ORDER BY id').all();original.close();
const env={...process.env,BRAIN_DESKTOP_LEGACY_DATA:path.join(root,'data'),PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`};
for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','ELECTRON_NO_ASAR','BRAIN_DESKTOP_USER_DATA'])delete env[key];
let desktop;
try{
 desktop=await electron.launch({executablePath:executable,env,cwd:process.env.TEMP,timeout:60000});
 const page=await desktop.firstWindow();await page.locator('.stats b').first().waitFor({timeout:90000});
 const actualRoot=await desktop.evaluate(({app})=>app.getPath('userData'));assert.equal(actualRoot,expectedRoot);
 const docs=await page.evaluate(async()=>await(await fetch('/api/documents')).json());
 for(const d of expected)assert.ok(docs.some(actual=>actual.id===d.id&&actual.title===d.title),'Preserved '+d.id);
 const data=new DatabaseSync(path.join(actualRoot,'data','brain.sqlite'),{readOnly:true});
 try{for(const d of data.prepare('SELECT path FROM documents').all())assert.ok(d.path.startsWith(path.join(actualRoot,'data','files')+path.sep));}finally{data.close();}
 await page.screenshot({path:'reports/electron-user-desktop.png',fullPage:true});
 await writeFile('reports/electron-user-data-migration.json',JSON.stringify({status:'passed',source:path.join(root,'data'),target:path.join(actualRoot,'data'),preservedDocuments:expected.length,originalUnchanged:true,log:await readFile(path.join(actualRoot,'logs','desktop.log'),'utf8')},null,2));
 console.log(`MIGRATION PASSED: ${expected.length} documents in ${actualRoot}`);
}finally{if(desktop)await desktop.close();}
