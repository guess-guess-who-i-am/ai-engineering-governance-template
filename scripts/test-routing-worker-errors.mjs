#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, copyFile, rm, realpath } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const home=await realpath(await mkdtemp(path.join(os.tmpdir(),'routing-errors-')));
const hooks=path.join(home,'hooks'),registry=path.join(home,'skill-registry');
const graph=path.join(registry,'graph.json');
const socketPath=path.join('/tmp',`codex-graph-${process.getuid()}`,createHash('sha256').update(graph).digest('hex').slice(0,24)+'.sock');
const call=entry=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(hooks,entry)],{env:{...process.env,CODEX_HOME:home,CODEX_GRAPH_TOOL_PYTHON:process.execPath},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
 child.stdin.end(JSON.stringify({hook_event_name:'UserPromptSubmit',prompt:'debug retrieval service failure',cwd:home}));
});
let mode='error',requests=0;
const server=net.createServer(connection=>connection.once('data',()=>{
 requests++;
 if(mode==='malformed')connection.end('not JSON\n');
 else if(mode==='error')connection.end(JSON.stringify({ok:false,error:'test retrieval failed'})+'\n');
 else connection.end(JSON.stringify({ok:true,results:[]})+'\n');
}));
try{
 await mkdir(hooks,{recursive:true});await mkdir(registry,{recursive:true});await mkdir(path.dirname(socketPath),{recursive:true,mode:0o700});
 for(const name of ['skill-router.mjs','routing-context.mjs','hook-dispatch.mjs'])await copyFile(path.join(process.env.ROUTING_HOOK_SOURCE || path.join(root,'codex-profile/.codex/hooks'),name),path.join(hooks,name));
 await writeFile(path.join(hooks,'context-refresh.mjs'),`process.stdout.write(JSON.stringify({hookSpecificOutput:{additionalContext:'fixed context remains observable'}}));`);
 await writeFile(path.join(hooks,'graph_skill_index.py'),'# transport fixture');await writeFile(graph,'{}');
 await writeFile(path.join(registry,'skills-index.json'),JSON.stringify({skills:[],externalGraphPath:graph}));await writeFile(path.join(registry,'routing-rules.json'),'{}');
 await new Promise(resolve=>server.listen(socketPath,resolve));
 for(const entry of ['skill-router.mjs','hook-dispatch.mjs']){
  for(const failure of ['error','malformed']){
   mode=failure;const before=requests;const r=await call(entry);assert.equal(requests,before+1,'fixture socket was not reached');assert.notEqual(r.code,0,`${entry} hid ${failure}: ${JSON.stringify(r)}`);assert(r.stderr.length>0);
   if(entry==='hook-dispatch.mjs')assert(r.stdout.includes('fixed context remains observable'));
  }
  mode='success';const r=await call(entry);assert.equal(r.code,0,r.stderr);assert.doesNotThrow(()=>JSON.parse(r.stdout));
 }
 console.log('PASS: router and dispatcher expose worker failures, preserve sibling output, and accept genuine empty success');
}finally{await new Promise(resolve=>server.close(resolve));await rm(socketPath,{force:true});await rm(home,{recursive:true,force:true});}
