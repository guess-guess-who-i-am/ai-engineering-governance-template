import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const anchor=(await readFile(path.join(root,'prompts/global-attention-anchor.en.md'),'utf8')).trim();
const events=[...Array.from({length:4},(_,n)=>({hook_event_name:'UserPromptSubmit',prompt:'请先猜测可能的根因，给出可证伪假设',session_id:'windows-hook-regression',turn_id:String(n+1),cwd:process.cwd()})),...['startup','resume','clear','compact'].map(source=>({hook_event_name:'SessionStart',source,cwd:process.cwd()}))];
const results=[];
for(const event of events){
 const started=Date.now();const result=spawnSync(process.execPath,[path.join(root,'hooks/hook-dispatch.mjs')],{input:JSON.stringify(event),encoding:'utf8',timeout:65000,windowsHide:true});
 assert.equal(result.status,0,result.stderr);const context=JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
 assert.equal(context.split(anchor).length-1,1,'Complete English reminders must appear exactly once on every event');
 assert(!context.includes('[HOOK_HANDLER_ERROR]'),result.stderr);assert(!context.includes('[SKILL_ROUTER_ERROR]'),result.stderr);
 if(event.hook_event_name==='UserPromptSubmit'){
   assert(context.includes('systematic-debugging'));assert(context.includes('[RESPONSE_LENGTH_GATE_V4]'));
   assert(context.includes('parallel-run.mjs'));assert([...context.matchAll(/^\s*Read:/gm)].length<=4);
 }
 results.push({event:event.hook_event_name,source:event.source,turn:event.turn_id,fullEnglishAnchor:true,milliseconds:Date.now()-started,characters:context.length});
}
await writeFile('.reports/windows-hook-output.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({passed:results.length,eachTurn:true,fourCandidateCap:true,fullEnglishAnchor:true}));
