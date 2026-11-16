import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{'ide-runtime':{type:'string'},output:{type:'string'}}});
assert(values['ide-runtime']);
const {createAgentRuntime}=await import(pathToFileURL(path.resolve(values['ide-runtime'])));
const root=await mkdtemp(path.join(os.tmpdir(),'live-in-task-'));
const codexHome=path.join(os.homedir(),'.codex');
const rows=[];
try{
 await Promise.all([0,1].map(async i=>{
  const cwd=path.join(root,`workspace-${i}`);await mkdir(cwd);
  const runtime=await createAgentRuntime({cwd,codexHome,homeDir:os.homedir(),treeBridgeFactory:async()=>({tools:[],instructions:'',close:async()=>{}})});
  try{
   const lifecycle={session_id:`live-in-task-${process.pid}-${i}`,turn_id:'one'};
   const input={...lifecycle,tool_name:'exec_command',tool_input:{cmd:i===0?'pytest tests/test_cache.py':'psql -f migrations/schema.sql'}};
   const started=Date.now();const first=await runtime.hooks('PreToolUse',input);
   const repeated=await runtime.hooks('PreToolUse',input);
   const failure=await runtime.hooks('PostToolUse',{...input,tool_response:{ok:false,exitCode:2}});
   const success=await runtime.hooks('PostToolUse',{...input,tool_response:{ok:true,exitCode:0}});
   assert(first.context.includes('[CODEX_SKILL_ROUTER_V2]'));
   assert.equal(repeated.context,'');assert.equal(success.context,'');
   assert(!first.blocked&&!failure.blocked);
   assert([...first.reports,...failure.reports].every(r=>r.ok));
   const read=first.context.match(/^\s+Read: (.+)$/m)?.[1];assert(read);
   const body=await runtime.call('read_file',{path:read});assert(body.content);
   const names=context=>[...context.matchAll(/^- (.+?) \[/gm)].map(match=>match[1]);
   rows.push({workspace:i,started,ended:Date.now(),candidates:names(first.context),failureCandidates:names(failure.context),firstBytes:Buffer.byteLength(first.context),repeatBytes:Buffer.byteLength(repeated.context),failureBytes:Buffer.byteLength(failure.context),successfulPostBytes:Buffer.byteLength(success.context),entryReadable:true,firstReports:first.reports.map(({durationMs,ok})=>({durationMs,ok})),failureReports:failure.reports.map(({durationMs,ok})=>({durationMs,ok}))});
  }finally{await runtime.close();}
 }));
 const report={status:'PASS',measuredAt:new Date().toISOString(),waveWidth:2,rows,modelQualityMeasured:false};
 if(values.output)await writeFile(values.output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{await rm(root,{recursive:true,force:true});}
