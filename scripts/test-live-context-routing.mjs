#!/usr/bin/env node
// Opt-in global Hook/graph test: independent sessions, bounded process overlap.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{router:{type:'string'},output:{type:'string'}}});
const router=values.router||path.join(os.homedir(),'.codex/hooks/skill-router.mjs');
const cases=JSON.parse(await readFile(new URL('./resource-retrieval-holdout.json',import.meta.url))).cases;
const selected=cases.filter(c=>['document-extract','research-evidence','spreadsheet-formulas','browser-functional'].includes(c.id));
const root=await mkdtemp(path.join(os.tmpdir(),'live-context-routing-'));
const rows=[];let cursor=0;
async function invoke(input){
 return await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[router],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill(),65000);
  child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.once('error',reject);
  child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});child.stdin.end(JSON.stringify(input));
 });
}
const references=new Map();
async function run(i){
 const c=selected[i%selected.length],session=`context-${process.pid}-${i}`,prompt='现在是推荐变得更好了吗？';
 const transcript=path.join(root,session+'.jsonl');
 const input={session_id:session,cwd:root,hook_event_name:'UserPromptSubmit',prompt};
 const messages=[{role:'user',content:c.zh}];
 if(i%2){
  await writeFile(transcript,[{type:'session_meta',payload:{id:session,cwd:root}},...messages.map(m=>({type:'response_item',payload:{type:'message',role:m.role,content:[{type:'input_text',text:m.content}]}}))].map(JSON.stringify).join('\n')+'\n');
  input.transcript_path=transcript;
 }else input.routing_context={schemaVersion:'routing-context/1',sessionId:session,cwd:root,messages};
 // Deliberately stagger arrivals; no synchronized start assumption.
 if(i%3)await new Promise(r=>setTimeout(r,(i%3)*7));
 const started=Date.now();const result=await invoke(input);
 assert.equal(result.code,0);assert.equal(result.stderr,'',result.stderr);
 const text=JSON.parse(result.stdout).hookSpecificOutput?.additionalContext||'';
 const names=[...text.matchAll(/^- (.+?) \[/gm)].map(m=>m[1]);
 assert.deepEqual(names,references.get(c.id),`${c.id}: followup differs from standalone query`);
 rows.push({session,task:c.id,transport:i%2?'transcript':'scoped-payload',started,ended:Date.now(),code:result.code,targetHit:c.targets.some(target=>names.includes(target)),names});
}
try{
 for(const c of selected){const r=await invoke({hook_event_name:'UserPromptSubmit',cwd:root,prompt:c.zh});assert.equal(r.stderr,'');assert.equal(r.code,0);const text=JSON.parse(r.stdout).hookSpecificOutput?.additionalContext||'';references.set(c.id,[...text.matchAll(/^- (.+?) \[/gm)].map(m=>m[1]));}
 const outcomes=await Promise.allSettled(Array.from({length:8},async()=>{for(;;){const i=cursor++;if(i>=100)return;await run(i);}}));
 const errors=outcomes.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'Live routing failed');
 const events=rows.flatMap(r=>[[r.started,1],[r.ended,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,peak=0;
 for(const [,delta] of events){active+=delta;peak=Math.max(peak,active);}
 assert(peak>1 && peak<=8);const times=rows.map(r=>r.ended-r.started).sort((a,b)=>a-b);
 const result={passed:true,requests:100,targetHits:rows.filter(r=>r.targetHit).length,standaloneEquivalent:rows.length,maxActive:peak,retries:0,timeouts:0,skipped:0,p50Ms:times[49],p95Ms:times[94],maxMs:times.at(-1),rows,limits:['100 requests at width 8, not 100 simultaneous processes.','Known relevant tasks test context transport and routing isolation; not general semantic accuracy.']};
 if(values.output)await writeFile(values.output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,rows:undefined}));
}finally{await rm(root,{recursive:true,force:true});}
