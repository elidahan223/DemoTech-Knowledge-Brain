import {spawn} from 'node:child_process';import {access} from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),base='http://127.0.0.1:3213';
let running;try{running=await(await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).json();}catch{}
if(running){if(running.repository!=='DemoTech-Organization')throw Error('Port 3213 belongs to a different repository.');console.log('DemoTech fictional organization is running: '+base);}else{
 await access(path.join(root,'repositories','DemoTech-Organization','brain.sqlite'));await access(path.join(root,'build/server/index.mjs'));
 const child=spawn(process.execPath,[path.join(root,'build/server/index.mjs')],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,NODE_ENV:'production',PORT:'3213',BRAIN_DATA_DIR:path.join(root,'repositories','DemoTech-Organization'),BRAIN_REPOSITORY_NAME:'DemoTech-Organization',BRAIN_SEED_DEMO:'0',RAG_EMBED_MODEL:'embeddinggemma:latest',BRAIN_PAUSE_BACKGROUND:'0'}});
 child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
}
