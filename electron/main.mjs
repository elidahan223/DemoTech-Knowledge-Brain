import {app,BrowserWindow,Menu,dialog,session,shell,utilityProcess} from 'electron';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {migrateLegacyData} from './data.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
app.setName('DemoTech Knowledge Brain');
const userRoot=path.resolve(process.env.BRAIN_DESKTOP_USER_DATA||path.join(app.getPath('appData'),'DemoTech Knowledge Brain'));
app.setPath('userData',userRoot);
const dataDir=path.join(userRoot,'data');
const logFile=path.join(userRoot,'logs','desktop.log');
let window,backend,origin='',quitting=false,backendStopped=false,stopTimer;
const token=randomBytes(32).toString('hex');
const escape=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function statusPage(title,message){return 'data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>DemoTech Knowledge Brain</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101827;color:#d7dfef;font-family:Segoe UI,Arial,sans-serif}main{max-width:650px;padding:40px;text-align:center}b{display:block;color:#aaaaff;font-size:64px}h1{font-size:25px;font-weight:500}p{line-height:1.9;color:#9dafc9;white-space:pre-wrap;overflow-wrap:anywhere}</style><main><b>✳</b><h1>${escape(title)}</h1><p>${escape(message)}</p></main></html>`);}
let allowedStatus=statusPage('המוח הארגוני נטען','מפעיל את השירות המקומי ומכין את המסמכים…\nההפעלה הראשונה עשויה להימשך מעט יותר.');
async function log(message){try{await mkdir(path.dirname(logFile),{recursive:true});await appendFile(logFile,`${new Date().toISOString()} ${message}\n`);}catch{console.error(message);}}
function allowedURL(value){try{return value===allowedStatus||(origin&&new URL(value).origin===origin);}catch{return false;}}

if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{
  if(!backend||backendStopped)return;
  event.preventDefault();if(quitting)return;quitting=true;
  backend.postMessage({type:'shutdown'});
  stopTimer=setTimeout(()=>backend?.kill(),5000);
  backend.once('exit',()=>{clearTimeout(stopTimer);backendStopped=true;backend=null;app.quit();});
 });
 app.whenReady().then(start).catch(fatal);
}

async function start(){
 await mkdir(path.join(userRoot,'logs'),{recursive:true});
 await log(`Starting ${app.getVersion()} packaged=${app.isPackaged}`);
 // This nonpersistent session never exposes a preload, Node, filesystem, or IPC API.
 const ses=session.fromPartition('brain-desktop');
 ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 ses.setPermissionCheckHandler(()=>false);
 ses.webRequest.onBeforeRequest((details,callback)=>{
  callback({cancel:!allowedURL(details.url)});
 });
 window=new BrowserWindow({width:1500,height:960,minWidth:900,minHeight:650,show:false,title:'DemoTech Knowledge Brain',backgroundColor:'#101827',icon:path.join(here,'assets','icon.ico'),webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:false}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(!allowedURL(url))event.preventDefault();});
 window.webContents.on('will-redirect',(event,url)=>{if(!allowedURL(url))event.preventDefault();});
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
 window.webContents.on('render-process-gone',(_event,details)=>{void log(`Renderer exited: ${details.reason}`);});
 window.once('ready-to-show',()=>window.show());
 await window.loadURL(allowedStatus);
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'DemoTech',submenu:[{label:'תיקיית הנתונים',click:()=>void shell.openPath(dataDir)},{label:'תיקיית היומנים',click:()=>void shell.openPath(path.dirname(logFile))},{type:'separator'},{label:'הפעלה מחדש',click:()=>{app.relaunch();app.quit();}},{label:'יציאה',role:'quit'}]},
  {label:'עריכה',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'תצוגה',submenu:[{label:'רענון',role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
 ]));
 const legacy=process.env.BRAIN_DESKTOP_LEGACY_DATA||(!app.isPackaged?path.join(app.getAppPath(),'data'):null);
 const migration=await migrateLegacyData(legacy,dataDir);await log(`Data migration: ${JSON.stringify(migration)}`);
 const configPath=path.join(userRoot,'settings.json');
 let settings={ollamaUrl:'http://127.0.0.1:11434',ollamaModel:'gemma3:4b'};
 try{const saved=JSON.parse(await readFile(configPath,'utf8'));settings={ollamaUrl:saved.ollamaUrl||settings.ollamaUrl,ollamaModel:saved.ollamaModel||settings.ollamaModel};}catch(e){if(e.code!=='ENOENT')throw new Error(`settings.json אינו תקין: ${e.message}`);await writeFile(configPath,JSON.stringify(settings,null,2));}
 if(typeof settings.ollamaUrl!=='string'||typeof settings.ollamaModel!=='string')throw new Error('הגדרות Ollama חייבות להיות טקסט');
 const unpackedRoot=app.isPackaged?app.getAppPath().replace(/app\.asar$/,'app.asar.unpacked'):app.getAppPath();
 const childEnv={...process.env,NODE_ENV:'production',PORT:'0',BRAIN_DESKTOP:'1',BRAIN_DESKTOP_TOKEN:token,BRAIN_DATA_DIR:dataDir,BRAIN_APP_ROOT:app.isPackaged?path.join(process.resourcesPath,'seed'):app.getAppPath(),BRAIN_STATIC_DIR:path.join(app.getAppPath(),'dist'),OLLAMA_URL:settings.ollamaUrl,OLLAMA_MODEL:settings.ollamaModel};
 for(const key of ['NODE_OPTIONS','ELECTRON_RUN_AS_NODE','ELECTRON_NO_ASAR'])delete childEnv[key];
 backend=utilityProcess.fork(path.join(unpackedRoot,'build','server','index.mjs'),[],{cwd:userRoot,env:childEnv,stdio:'pipe',serviceName:'DemoTech Local Backend'});
 backend.stdout?.on('data',chunk=>void log(`[backend] ${chunk.toString().trimEnd()}`));
 backend.stderr?.on('data',chunk=>void log(`[backend] ${chunk.toString().trimEnd()}`));
 backend.on('exit',code=>{backendStopped=true;void log(`Backend exited ${code}`);if(!quitting)void fatal(new Error('השירות המקומי נעצר. ניתן להפעיל מחדש מתוך תפריט DemoTech.'));});
 const port=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('השירות המקומי לא היה מוכן בתוך שתי דקות. עיינו ביומן ההפעלה.')),120000);
  backend.once('exit',code=>{clearTimeout(timer);reject(new Error(`השירות המקומי נסגר בזמן ההפעלה (${code}).`));});
  backend.on('message',message=>{if(message?.type==='ready'&&Number.isInteger(message.port)&&message.port>0){clearTimeout(timer);resolve(message.port);}else if(message?.type==='error'){clearTimeout(timer);reject(new Error(message.message));}});
 });
 origin=`http://127.0.0.1:${port}`;
 const response=await fetch(`${origin}/api/health`,{headers:{'X-Brain-Token':token},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('בדיקת המוכנות של השירות המקומי נכשלה');
 const state=await response.json();await log(`Backend ready on port ${port}; Ollama online=${state.ollama.online} modelAvailable=${state.ollama.available}`);
 await ses.cookies.set({url:origin,name:'brain-session',value:token,httpOnly:true,sameSite:'strict',path:'/'});
 await window.loadURL(origin);
}

async function fatal(error){
 await log(`ERROR: ${error.stack||error.message}`);
 const message=`${error.message}\n\nהנתונים נשמרים בתיקייה:\n${dataDir}\n\nיומן הפעלה:\n${logFile}`;
 if(window&&!window.isDestroyed()){allowedStatus=statusPage('לא ניתן להפעיל את המערכת',message);await window.loadURL(allowedStatus).catch(()=>{});window.show();}
 else{dialog.showErrorBox('DemoTech Knowledge Brain',message);app.quit();}
}
