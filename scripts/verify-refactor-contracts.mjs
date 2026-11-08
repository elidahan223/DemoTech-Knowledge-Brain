import ts from 'typescript';import {readFile,writeFile,readdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const before=await readFile('reports/refactor/before/server-generate-answer.ts','utf8');
const ast=ts.createSourceFile('before.ts',before,ts.ScriptTarget.Latest,true);const fn=ast.statements.find(ts.isFunctionDeclaration);const nodes=[...fn.body.statements];
const name=(node,value)=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)===value);
const text=node=>before.slice(node.getStart(ast),node.end);
const start=nodes.findIndex(n=>name(n,'english')),end=nodes.findIndex(n=>name(n,'raw'));const call=nodes[end].declarationList.declarations[0].initializer.expression;
const baselineCode=`function baseline(input){const {question,currentQuestion,query,organization,global,feedback,translating,conversation,context,evidence}=input;${nodes.slice(start,end).map(text).join('\n')}return {messages:${text(call.arguments[0])},schema:${text(call.arguments[1])},tasks,english};} return baseline;`;
const baseline=new Function(ts.transpileModule(baselineCode,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)();
const {buildAnswerRequest}=await import('../server/Prompts/ChatPrompts.ts');let promptCases=0;
for(const global of [true,false])for(const feedback of [true,false])for(const translating of [true,false])for(const english of [true,false])for(const tasks of [true,false]){
 const question=english?'in English':'שאלה בעברית',currentQuestion=tasks?'תחומי האחריות והמשימות':question;
 const input={question,currentQuestion,query:currentQuestion,organization:'Example',global,feedback,translating,conversation:{question:'previous',answer:'previous answer',evidence:[]},context:'[E1] Document: Example\nSource excerpt.',evidence:[{id:'E1',source:1,text:'Source excerpt.'}]};
 assert.deepEqual(buildAnswerRequest(input),baseline(input));promptCases++;
}
const parse=(file,text)=>ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
const canonical=node=>{if(ts.isParenthesizedExpression(node))return canonical(node.expression);const children=[];node.forEachChild(child=>{children.push(canonical(child));});return [node.kind,...(typeof node.text==='string'?[node.text]:[]),...children];};
function routes(text,object){const file=parse('route.ts',text.replaceAll(/\baiBusy\b/g,'aiExecution.busy'));const found=[];function visit(node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(file)===object&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){const url=node.arguments[0].text;if(object!=='app'||url.startsWith('/api/'))found.push({method:node.expression.name.text,path:url.replace(/^\/api\//,'/'),handlers:node.arguments.slice(1).map(canonical)});}ts.forEachChild(node,visit);}visit(file);return found;}
const oldRoutes=routes(await readFile('reports/refactor/before/server-index.ts','utf8'),'app');const newRoutes=[];for(const file of await readdir('server/Controllers'))newRoutes.push(...routes(await readFile('server/Controllers/'+file,'utf8'),'router'));
const sort=list=>list.sort((a,b)=>(a.method+a.path).localeCompare(b.method+b.path));assert.deepEqual(sort(newRoutes),sort(oldRoutes));
const result={promptCases,allPromptsAndSchemasUnchanged:true,apiRoutes:oldRoutes.length,allRoutePathsAndHandlersUnchanged:true};await writeFile('reports/refactor/contracts.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
