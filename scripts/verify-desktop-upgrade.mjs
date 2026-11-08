import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const dataDir=path.join(process.env.APPDATA,'DemoTech Knowledge Brain','data');
const db=new DatabaseSync(path.join(dataDir,'brain.sqlite'),{readOnly:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
const rows=db.prepare('SELECT id,name,title,text,path,status FROM documents ORDER BY id').all();
const fingerprint=hash(JSON.stringify(rows));const chunks=db.prepare('SELECT count(*) AS count FROM chunks').get().count;db.close();
const files=[];for(const row of rows)files.push({id:row.id,hash:hash(await readFile(row.path))});
const file='reports/desktop-upgrade-data.json';
if(process.argv[2]==='capture'){await writeFile(file,JSON.stringify({before:{documents:rows.length,fingerprint,chunks,files}},null,2));console.log(`Captured ${rows.length} existing documents before Desktop upgrade`);}
else{const report=JSON.parse(await readFile(file,'utf8'));assert.equal(fingerprint,report.before.fingerprint);assert.equal(chunks,report.before.chunks);assert.deepEqual(files,report.before.files);report.after={documents:rows.length,fingerprint,chunks,files};report.status='passed';await writeFile(file,JSON.stringify(report,null,2));console.log(`UPGRADE DATA PRESERVATION PASSED: ${rows.length} documents, ${chunks} indexed chunks`);}
