import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const normalize=text=>text.normalize('NFKC').replace(/\s+/g,' ').trim();
const match=(text,pattern)=>new RegExp(pattern,'i').test(normalize(text));
export async function evaluateEnterprise({base,out,source,docs,onProgress=async()=>{}}){
 const cases=JSON.parse(await readFile(path.join(process.cwd(),'test-data','enterprise-3000-questions.json'),'utf8'));const byName=new Map(docs.map(d=>[d.name,d]));const byId=new Map(docs.map(d=>[d.id,d]));const texts=new Map();
 const original=async name=>{if(!texts.has(name))texts.set(name,(await readFile(path.join(source,name),'utf8')).replace(/^\uFEFF/,'').trim());return texts.get(name);};
 const post=async(endpoint,body)=>{const r=await fetch(base+'/api'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error(`${endpoint} ${r.status}: ${(await r.text()).slice(0,500)}`);return r.json();};
 for(const test of cases)if(!test.unanswerable){const raw=await original(test.file);if(!byName.has(test.file))throw Error('Gold source was not imported: '+test.file);for(const facet of test.facets)if(!match(raw,facet.pattern))throw Error(`Invalid expected fact in ${test.id}: ${facet.label}`);if(!raw.includes(test.anchor))throw Error('Gold anchor missing: '+test.id);}
 const results=[];
 for(const test of cases){const result={...test};
  if(test.file){const doc=byName.get(test.file);result.expectedDocumentId=doc.id;result.expectedTitle=doc.title;const raw=await original(test.file);const start=raw.indexOf(test.anchor);result.goldQuote=raw.slice(Math.max(0,start-100),Math.min(raw.length,start+900));}
  try{
   let t=Date.now();result.lexical=await post('/search',{question:test.question,strategy:'lexical'});result.lexicalMs=Date.now()-t;t=Date.now();result.hybrid=await post('/search',{question:test.question,strategy:'hybrid'});result.hybridMs=Date.now()-t;
   t=Date.now();const answer=await post('/chat',{question:test.question});result.answerMs=Date.now()-t;result.answer=answer.answer;result.mode=answer.mode;result.sources=answer.sources;result.evidence=answer.evidence||[];
   result.lexicalGoldRecall=test.unanswerable?null:result.lexical.some(s=>s.documentId===result.expectedDocumentId);result.hybridGoldRecall=test.unanswerable?null:result.hybrid.some(s=>s.documentId===result.expectedDocumentId);
   result.facets=test.facets.map(f=>({...f,matched:match(answer.answer,f.pattern)}));result.facetCoverage=result.facets.length?result.facets.filter(f=>f.matched).length/result.facets.length:null;
   const supports=[];for(const statement of result.evidence){const reference=answer.sources.find(s=>s.citation===statement.source);const document=reference&&byId.get(reference.documentId);const valid=Boolean(document&&(await original(document.name)).includes(statement.quote)&&statement.text===statement.quote);supports.push({citation:statement.source,documentId:document?.id,file:document?.name,exactSourceQuote:valid,strictGoldSource:document?.id===result.expectedDocumentId});}
   result.citationChecks=supports;result.faithfulness=supports.length?supports.filter(s=>s.exactSourceQuote).length/supports.length:null;result.strictCitationPrecision=supports.length?supports.filter(s=>s.strictGoldSource).length/supports.length:null;
   const abstained=['no-sources','no-supported-answer'].includes(answer.mode);
   result.quality=test.unanswerable?(abstained?'correct-abstention':'unsupported-answer'):result.faithfulness!==null&&result.faithfulness<1?'unsupported-quote':result.facetCoverage===1&&supports.some(s=>s.strictGoldSource)?'full':result.facetCoverage===1?'alternative-source-needs-review':result.facetCoverage>0?'partial':'incorrect';
   result.outputLanguage=test.language==='he'?/[א-ת]{2,}/.test(answer.answer)?'contains-hebrew':'english-extracts-only':'not-assessed';
  }catch(error){result.quality='system-error';result.error=error.stack;}
  results.push(result);await writeFile(path.join(out,'quality-questions.json'),JSON.stringify(results,null,2));await onProgress(result);
 }
 const answerable=results.filter(r=>!r.unanswerable);const negatives=results.filter(r=>r.unanswerable);const citations=results.flatMap(r=>r.citationChecks||[]);const facets=answerable.flatMap(r=>r.facets||[]);
 const summary={answerableQuestions:answerable.length,negativeControls:negatives.length,fullCorrect:answerable.filter(r=>r.quality==='full').length,partial:answerable.filter(r=>r.quality==='partial').length,incorrect:answerable.filter(r=>['incorrect','unsupported-quote','system-error'].includes(r.quality)).length,alternativeSourceReview:answerable.filter(r=>r.quality==='alternative-source-needs-review').length,lexicalRecallAt6:answerable.filter(r=>r.lexicalGoldRecall).length/answerable.length,hybridRecallAt6:answerable.filter(r=>r.hybridGoldRecall).length/answerable.length,facetCoverage:facets.filter(f=>f.matched).length/facets.length,exactQuoteFaithfulness:citations.filter(c=>c.exactSourceQuote).length/Math.max(1,citations.length),strictGoldCitationPrecision:citations.filter(c=>c.strictGoldSource).length/Math.max(1,citations.length),correctAbstentions:negatives.filter(r=>r.quality==='correct-abstention').length,hebrewQuestionsAnsweredWithEnglishExtracts:answerable.filter(r=>r.language==='he'&&r.outputLanguage==='english-extracts-only').length,note:'Gold source sets contain one manually selected source per question and are not exhaustive. Exact quote support does not by itself prove relevance. Cases requiring alternative-source review are not silently counted as correct.'};
 await writeFile(path.join(out,'quality-summary.json'),JSON.stringify(summary,null,2));return {summary,results};
}
