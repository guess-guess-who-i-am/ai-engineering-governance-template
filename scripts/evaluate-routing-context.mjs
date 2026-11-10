#!/usr/bin/env node
// Diagnostic conversational retrieval comparison; no model or production writes.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{baseline:{type:'string'},output:{type:'string'},router:{type:'string'}}});
const root=path.resolve(import.meta.dirname,'..');
const router=values.router||path.join(root,'codex-profile/.codex/hooks/skill-router.mjs');
if(!values.baseline||!values.output)throw Error('Pass --baseline and --output');
const cases=JSON.parse(await readFile(path.join(root,'scripts/resource-retrieval-holdout.json'),'utf8')).cases;
const scratch=await mkdtemp(path.join(os.tmpdir(),'routing-context-eval-'));
const base={hook_event_name:'UserPromptSubmit',cwd:scratch};
const rows=[];
async function invoke(file,input){
 const start=Date.now();
 return await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[file],{env:{...process.env,CODEX_HOME:process.env.CODEX_HOME||path.join(os.homedir(),'.codex')},stdio:['pipe','pipe','pipe']});
  let out='',err='';const timer=setTimeout(()=>child.kill(),65000);
  child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);try{if(code!==0||err.trim())throw Error(`Router failure ${code}: ${err}`);const context=JSON.parse(out).hookSpecificOutput?.additionalContext||'';resolve({names:[...context.matchAll(/^- (.+?) \[/gm)].map(m=>m[1]),ms:Date.now()-start});}catch(e){reject(e);}});child.stdin.end(JSON.stringify(input));
 });
}
try{
 const jobs=cases.flatMap(c=>['zh','en'].map(language=>({c,language})));
 for(let offset=0;offset<jobs.length;offset+=4){
  const wave=await Promise.all(jobs.slice(offset,offset+4).map(async({c,language},i)=>{
   const prompt=language==='zh'?'效果怎么样？':'Is it better now?';
   const session=`eval-${offset+i}`;const transcript=path.join(scratch,session+'.jsonl');
   const records=[{type:'session_meta',payload:{id:session,cwd:scratch}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:c[language]}]}}];
   await writeFile(transcript,records.map(JSON.stringify).join('\n')+'\n');
   const input={...base,prompt,session_id:session,transcript_path:transcript};
   const before=await invoke(values.baseline,input);const after=await invoke(router,input);
   const baselineStandalone=await invoke(values.baseline,{...base,prompt:c[language],session_id:session+'-baseline-standalone'});
   const standalone=await invoke(router,{...base,prompt:c[language],session_id:session+'-standalone'});
   const hit=result=>result.names.some(n=>c.targets.includes(n));
   return {id:c.id,language,targets:c.targets,before:{...before,hit:hit(before)},after:{...after,hit:hit(after)},standalone:{...standalone,hit:hit(standalone)},baselineStandalone:{...baselineStandalone,hit:hit(baselineStandalone)},wave:offset/4};
  }));rows.push(...wave);console.log(JSON.stringify({done:rows.length,total:jobs.length,beforeHits:rows.filter(r=>r.before.hit).length,afterHits:rows.filter(r=>r.after.hit).length}));
 }
 const result={schemaVersion:'routing-context-eval/1',queries:rows.length,beforeHits:rows.filter(r=>r.before.hit).length,afterHits:rows.filter(r=>r.after.hit).length,standaloneHits:rows.filter(r=>r.standalone.hit).length,standaloneRegressions:rows.filter(r=>r.baselineStandalone.hit&&!r.standalone.hit).map(r=>r.id+'/'+r.language),baselineStandaloneHits:rows.filter(r=>r.baselineStandalone.hit).length,regressions:rows.filter(r=>r.before.hit&&!r.after.hit).map(r=>r.id+'/'+r.language),rows,limits:['Diagnostic followups derived from existing task labels, not a new independent business benchmark.','One history task per case; multi-turn mechanisms and isolation require separate tests.','No business workflow or model answer quality measured.']};
 await writeFile(values.output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({queries:result.queries,beforeHits:result.beforeHits,afterHits:result.afterHits,standaloneHits:result.standaloneHits,regressions:result.regressions}));
}finally{await rm(scratch,{recursive:true,force:true});}
