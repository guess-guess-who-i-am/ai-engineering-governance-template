import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const cases=[
 ['设计一个清晰、易用的前端设置页面。',['build-designed-interface','ckw-design','ce-frontend-design','ck:frontend-design']],
 ['帮我做前端界面设计','build-designed-interface'],
 ['Build a clear and usable frontend settings page.','build-designed-interface'],
 ['请定位并复现这个软件的故障，先提出可验证的根因假设。','systematic-debugging'],
 ['Diagnose the root cause of this reproducible software bug.','systematic-debugging'],
 ['选择论文实验的代表性baseline和benchmark，核对权威引用。','method-research-evidence'],
 ['Show the current task graph focus and execution scope using task_tree_focus','task_tree_focus'],
 ['你好',null],
 ['谢谢',null],
 ['今天心情不错。',null]
];
async function probe([prompt,expected]){
 const began=Date.now();
 return new Promise(resolve=>{
  const child=spawn(process.execPath,[path.join(root,'hooks/skill-router.mjs')],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill(),65000);
  child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
  child.on('error',e=>{stderr+=e.message;});
  child.on('close',exitCode=>{clearTimeout(timer);let body='';try{body=JSON.parse(stdout).hookSpecificOutput?.additionalContext||'';}catch{}
   const candidates=[...body.matchAll(/^- (.+?) \[(?:Skill|MCP\/)/gm)].map(x=>x[1]);
   const acceptable=Array.isArray(expected)?expected:expected?[expected]:[];
   resolve({prompt,expected,exitCode,stderr,candidates,ms:Date.now()-began,passed:exitCode===0&&!stderr&&candidates.length<=4&&(acceptable.length?acceptable.includes(candidates[0]):candidates.length===0)});
  });
  child.stdin.end(JSON.stringify({hook_event_name:'UserPromptSubmit',prompt,cwd:process.cwd()}));
 });
}
const results=[];
for(let offset=0;offset<cases.length;offset+=4)results.push(...await Promise.all(cases.slice(offset,offset+4).map(probe)));
await mkdir('.reports',{recursive:true});
await writeFile('.reports/skill-routing-quality.json',JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length,results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
assert(results.every(r=>r.passed),'Real routing failed quality or hard-negative cases');
