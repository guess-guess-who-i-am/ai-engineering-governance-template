#!/usr/bin/env node
// Execute the real IDE turn owner with controlled model transport and runtime.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,cp,symlink,writeFile,rm,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{runner:{type:'string'},report:{type:'string'},baseline:{type:'boolean',default:false},'live-hooks':{type:'boolean',default:false}}});
if(!values.runner)throw Error('Pass --runner pointing to the real IDE deepseek-run.js');
const repository=path.resolve(import.meta.dirname,'..');
const root=await mkdtemp(path.join(os.tmpdir(),'ide-routing-context-'));
const originalFetch=globalThis.fetch;
const rows=[],liveRuntimes=[];
try{
 const kit=path.join(root,'kit');await mkdir(kit);
 const sourceServer=path.dirname(path.resolve(values.runner));
 await cp(sourceServer,path.join(kit,'server'),{recursive:true,filter:p=>!p.includes('/backups/')&&!p.endsWith('.log')});
 await cp(path.join(sourceServer,'../package.json'),path.join(kit,'package.json'));
 await symlink(path.join(sourceServer,'../node_modules'),path.join(kit,'node_modules'),'dir');
 await symlink(path.join(sourceServer,'../scripts'),path.join(kit,'scripts'),'dir');
 await symlink(path.join(sourceServer,'../public'),path.join(kit,'public'),'dir');
 const runner=path.join(kit,'server/deepseek-run.js');
 if(!values.baseline){
  const patched=spawnSync('python3',[path.join(repository,'scripts/patch-ide-routing-context.py'),'--runner',runner],{encoding:'utf8'});assert.equal(patched.status,0,patched.stderr);
  const again=spawnSync('python3',[path.join(repository,'scripts/patch-ide-routing-context.py'),'--runner',runner,'--check'],{encoding:'utf8'});assert.equal(again.status,0,again.stderr);assert.equal(JSON.parse(again.stdout).changed,false);
 }
 const {startDeepSeekTurn}=await import(pathToFileURL(runner));
 for(const mode of ['supplied','resumed','forked']){
  const cwd=path.join(root,mode);await mkdir(cwd);const order=[],hooks=[],requests=[];let routedNames=[];
  const history=[{role:'user',content:'Investigate PostgreSQL index construction and lock waits.'},{role:'assistant',content:'Option two uses CREATE INDEX CONCURRENTLY.'}];
  const prompt='How about the second option?';
  globalThis.fetch=async(_url,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[{message:{content:'The concurrent index approach requires checking lock waits and invalid indexes.'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}}),{headers:{'content-type':'application/json'}});};
  const liveRuntime=values['live-hooks'] ? await (await import(pathToFileURL(path.join(sourceServer,'agent-runtime.js')))).createAgentRuntime({cwd,treeBridgeFactory:async()=>({tools:[],instructions:'',close:async()=>{}})}) : null;
  if(liveRuntime)liveRuntimes.push(liveRuntime);
  const runtime={systemPrompt:'test',skillCount:0,hookSources:[],tools:[],loadContext:async()=>{order.push('context');return null;},loadDialogue:async()=>{order.push('dialogue');return history;},
   hooks:async(event,input)=>{order.push(event);hooks.push({event,input});if(liveRuntime && event==='UserPromptSubmit'){const result=await liveRuntime.hooks(event,input);assert(!result.blocked);assert(result.reports.every(r=>r.ok && !r.stderr),JSON.stringify(result.reports));routedNames=[...result.context.matchAll(/^- (.+?) \[/gm)].map(m=>m[1]);assert(routedNames.some(name=>/^postgresql(?:$|-)/.test(name)), 'Global Hook lost the PostgreSQL task: '+routedNames);return result;}return {blocked:false,context:'',reports:[]};},close:async()=>{}};
  const result=await startDeepSeekTurn({cwd,prompt,waitForCompletion:true,persistDialogue:false,historyPolicy:'full',
   environment:{MODEL_AGENT_MAIN_BASE_URL:'https://isolated.invalid',MODEL_AGENT_MAIN_API_KEY:'test-only',MODEL_AGENT_MAIN_MODEL:'test-model',TASK_TREE_GLOBAL_ENV_FILE:path.join(root,'absent.env'),TASK_TREE_PROJECT_ROOT:cwd},
   ...(mode==='supplied'?{messages:[...history,{role:'user',content:prompt}]}:mode==='resumed'?{threadId:'deepseek-fixture'}:{forkThreadId:'deepseek-fork-fixture'}),
   runtimeFactory:async()=>runtime});
  assert.equal(result.status,'completed',result.error?.message);assert.equal(requests.length,1);
  const hook=hooks.find(h=>h.event==='UserPromptSubmit');assert(hook?.input.routing_context,'IDE omitted conversational routing context');
  assert.equal(hook.input.routing_context.sessionId,result.threadId);assert.equal(hook.input.routing_context.cwd,cwd);
  const {routingQuery}=await import('../codex-profile/.codex/hooks/routing-context.mjs');
  const query=await routingQuery({...hook.input,cwd},prompt);assert(query.includes('PostgreSQL'));assert(query.includes('CREATE INDEX CONCURRENTLY'));
  if(mode!=='supplied')assert(order.indexOf('dialogue')<order.indexOf('UserPromptSubmit'));
  assert(requests[0].messages.some(m=>m.role==='user'&&m.content===history[0].content),'Model dialogue was altered by routing transport');
  await liveRuntime?.close();
  rows.push({mode,liveHooks:Boolean(liveRuntime),routedNames,order,modelRequests:requests.length,query,contextBytes:Buffer.byteLength(JSON.stringify(hook.input.routing_context)),passed:true});
 }
 const report={passed:true,scope:'Real IDE turn owner and Hook ordering, controlled model transport; no business-model-quality claim',runner:values.runner,rows};
 if(values.report)await writeFile(values.report,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await Promise.allSettled(liveRuntimes.map(r=>r.close()));globalThis.fetch=originalFetch;await rm(root,{recursive:true,force:true});}
