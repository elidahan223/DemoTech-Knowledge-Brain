import {backup,DatabaseSync} from 'node:sqlite';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {db,dataDir} from '../server/store.js';
import {enqueue,processJobs} from '../server/ingest.js';
// Use the real text/vector lifecycle; never leave vectors pointing to replaced chunks.
const destination=path.join(dataDir,'backups',`before-reindex-${Date.now()}.sqlite`);
await mkdir(path.dirname(destination),{recursive:true});await backup(db,destination);
const check=new DatabaseSync(destination,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw Error('Backup integrity check failed');}finally{check.close();}
const docs=db.prepare("SELECT id FROM documents WHERE status='ready'").all() as {id:string}[];
for(const doc of docs)enqueue(doc.id);
console.log(`Verified backup: ${destination}; queued ${docs.length} documents through the normal ingestion pipeline.`);
if(process.env.BRAIN_PAUSE_BACKGROUND==='1')console.log('Background processing is paused; existing indexes were preserved.');else await processJobs();
