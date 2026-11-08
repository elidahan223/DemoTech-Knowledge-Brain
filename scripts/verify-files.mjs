import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base='http://127.0.0.1:3210/api';
async function upload(bytes,name){const f=new FormData();f.append('files',new Blob([bytes]),name);const r=await fetch(base+'/documents',{method:'POST',body:f});assert.equal(r.status,202);return (await r.json())[0];}
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage();await page.setContent('<html><body><h1>DemoTech PDF integration fixture</h1><p>A text document for local validation.</p></body></html>');const validPdf=await page.pdf();await browser.close();
const result=await upload(validPdf,'fixture.pdf');assert.ok(result.id);
try{let ready=false;for(let i=0;i<100;i++){const doc=await(await fetch(base+'/documents/'+result.id)).json();if(doc.status==='error')throw new Error(doc.error);if(doc.status==='ready'){assert.ok(doc.text.includes('DemoTech PDF integration fixture'));ready=true;break;}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,'PDF processing timeout');}finally{await fetch(base+'/documents/'+result.id,{method:'DELETE'});}
const duplicate=await upload(await readFile('docs/FIN-001.docx'),'duplicate.docx');assert.equal(duplicate.id,'FIN-001');assert.equal(duplicate.duplicate,true);
const invalid=await upload('invalid','invalid.pdf');assert.ok(invalid.error);
await writeFile('reports/file-validation.json',JSON.stringify({pdfUploadExtractionDelete:'passed',duplicatePrevention:'passed',invalidSignature:'passed'},null,2));console.log('FILE VALIDATION PASSED');
