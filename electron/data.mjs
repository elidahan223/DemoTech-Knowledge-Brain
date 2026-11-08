import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,copyFile,rename,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

async function exists(file){try{await access(file);return true;}catch{return false;}}

// Snapshot the live WAL database, copy its referenced files, and rebase absolute paths.
// Never replace an existing Desktop database or modify the original project.
export async function migrateLegacyData(source,target){
 if(await exists(path.join(target,'brain.sqlite')))return {migrated:false,reason:'desktop-data-exists'};
 if(!source||!await exists(path.join(source,'brain.sqlite')))return {migrated:false,reason:'no-legacy-data'};
 if(await exists(target)&&(await readdir(target)).length)throw new Error('תיקיית הנתונים מכילה קבצים אך אין בה מסד תקין. לא נדרסו נתונים.');
 const parent=path.dirname(target);await mkdir(parent,{recursive:true});
 const stage=path.join(parent,`.migration-${randomUUID()}`);await mkdir(path.join(stage,'files'),{recursive:true});
 const sourceDb=new DatabaseSync(path.join(source,'brain.sqlite'),{readOnly:true});
 try{await backup(sourceDb,path.join(stage,'brain.sqlite'));}finally{sourceDb.close();}
 const snapshot=new DatabaseSync(path.join(stage,'brain.sqlite'));
 try{
  const docs=snapshot.prepare('SELECT id,path FROM documents').all();
  for(const doc of docs){
   const name=path.basename(doc.path);
   if(!name||name==='.'||name==='..')throw new Error('נתיב מסמך לא תקין במסד המקור');
   // Read only inside the selected legacy files directory, even for a relocated project.
   await copyFile(path.join(source,'files',name),path.join(stage,'files',name));
   snapshot.prepare('UPDATE documents SET path=? WHERE id=?').run(path.join(target,'files',name),doc.id);
  }
  snapshot.exec("UPDATE jobs SET status='queued' WHERE status='processing'; PRAGMA wal_checkpoint(TRUNCATE)");
 }finally{snapshot.close();}
 if(await exists(target)){
  // The only permitted pre-existing target is an empty directory.
  await rename(path.join(stage,'files'),path.join(target,'files'));
  await rename(path.join(stage,'brain.sqlite'),path.join(target,'brain.sqlite'));
 }else await rename(stage,target);
 return {migrated:true};
}
