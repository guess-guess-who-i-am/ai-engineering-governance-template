import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {PIN,adaptWorker,adaptRouter,adaptRefresh,adaptDispatcher} from './install-mac-profile-on-windows.mjs';

const root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const manifest=JSON.parse(await readFile(path.join(root,'skill-registry/mac-source.json'),'utf8'));
assert.equal(manifest.commit,PIN);
const source=manifest.source;
const effective=relative=>manifest.policyFiles?.some(item=>item.file===relative)?path.join(manifest.policySource,relative):path.join(source,relative);
for(const item of manifest.policyFiles||[]){const bytes=await readFile(effective(item.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,'Declared policy source drift: '+item.file);}
const checks=[];
for(const name of await readdir(path.join(source,'codex-profile/.codex/prompts'))){
 const a=await readFile(effective('codex-profile/.codex/prompts/'+name));
 const b=await readFile(path.join(root,'prompts',name));assert(a.equals(b),'Prompt was rewritten: '+name);
 checks.push('exact prompt: '+name);
}
for(const name of await readdir(path.join(source,'codex-profile/global-skills'))){
 if(name==='README.md')continue;
 const a=await readFile(effective('codex-profile/global-skills/'+name+'/SKILL.md'));
 const b=await readFile(path.join(os.homedir(),'.agents/skills',name,'SKILL.md'));assert(a.equals(b),'Skill was rewritten: '+name);
 checks.push('exact Skill: '+name);
}
assert((await readFile(effective('codex-profile/mac/hooks/context-refresh.mjs'))).equals(await readFile(path.join(root,'hooks/context-refresh.mjs'))),'Effective cadence/scheduling policy drifted');
for(const [relative,name,adapt]of [
 ['codex-profile/mac/hooks/graph_skill_index.py','graph_skill_index.py',adaptWorker],
 ['codex-profile/.codex/hooks/skill-router.mjs','skill-router.mjs',adaptRouter],
 ['codex-profile/mac/hooks/refresh-skill-registry.mjs','refresh-skill-registry.mjs',adaptRefresh],
 ['codex-profile/.codex/hooks/hook-dispatch.mjs','hook-dispatch.mjs',adaptDispatcher]
])assert.equal((await readFile(path.join(root,'hooks',name),'utf8')).replace(/\r\n/g,'\n'),adapt(await readFile(effective(relative),'utf8')),'Undeclared platform changes: '+name);

const session='native-mac-regression-'+Date.now();
const events=[];
for(let n=1;n<=4;n++){
 const input={hook_event_name:'UserPromptSubmit',session_id:session,turn_id:String(n),prompt:'Diagnose a reproducible software bug',cwd:process.cwd()};
 const result=spawnSync(process.execPath,[path.join(root,'hooks/hook-dispatch.mjs')],{input:JSON.stringify(input),encoding:'utf8',timeout:65000,windowsHide:true});
 assert.equal(result.status,0,result.stderr);
 assert(!/GraphToolCall routing failed|timed out|exited with code/i.test(result.stderr),'External graph retrieval failed: '+result.stderr);
 const text=JSON.parse(result.stdout).hookSpecificOutput?.additionalContext||'';
 assert.equal(text.includes('[GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3]'),n===1||n===4,'Fixed reminder cadence differs from macOS');
 assert(text.includes('[CODEX_SKILL_ROUTER_V2]'),'Dynamic routing missing on turn '+n);
 assert([...text.matchAll(/^\s*Read:|^\s*Call through indexed MCP server:/gm)].length<=4);
 events.push({turn:n,characters:text.length,fixed:n===1||n===4,dynamic:true,stderr:result.stderr.trim()});
}
const result={sourceCommit:PIN,policyRevision:manifest.policyRevision||null,comparison:'effective approved source, not an assertion of unchanged baseline prompts',exactPromptFiles:checks.filter(x=>x.startsWith('exact prompt')).length,exactSkills:checks.filter(x=>x.startsWith('exact Skill')).length,exactCadenceAndScheduling:true,events};
await writeFile('.reports/mac-profile-windows-validation.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
