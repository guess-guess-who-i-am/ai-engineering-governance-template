import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const fixture=await mkdtemp(path.join(os.tmpdir(),'codex-project-hook-'));
const run=(command,args,options={})=>spawnSync(command,args,{cwd:fixture,encoding:'utf8',windowsHide:true,timeout:10000,...options});
try{
 assert.equal(run('git',['init','--quiet']).status,0);
 await mkdir(path.join(fixture,'.codex/hooks'),{recursive:true});await mkdir(path.join(fixture,'llm-task-tree'),{recursive:true});
 for(const file of ['turn-start.mjs','stop-postflight.mjs','workspace-snapshot.mjs'])await copyFile('.codex/hooks/'+file,path.join(fixture,'.codex/hooks',file));
 await copyFile('llm-task-tree/runtime-location.mjs',path.join(fixture,'llm-task-tree/runtime-location.mjs'));
 await writeFile(path.join(fixture,'.gitignore'),'.reports/\n.task-tree-maintenance/\nversions/\n');
 await writeFile(path.join(fixture,'task-tree.md'),'# LLM Task Graph\n\n## ROOT - 检查Hook\n\n- Completion: 进行中\n- Problem: 能否在真实入口检查任务维护？\n- Approach: 通过真实输入检查启动和结束。\n- Metrics: 正例通过，未维护的代码改动被拦截。\n- CurrentResult: 已有可执行入口，仍需通过行为测试。\n- NextIdea: 运行窄测试。\n\n# GraphState\n\n- Current: ROOT\n- Next: ROOT\n\n# Edges\n');
 await mkdir(path.join(fixture,'.reports/cache'),{recursive:true});await writeFile(path.join(fixture,'.reports/cache/model.tmp'),'ignored');
 const input={cwd:fixture,hook_event_name:'UserPromptSubmit',session_id:'hook-runtime',turn_id:'1'};
 const start=Date.now();const began=run(process.execPath,['.codex/hooks/turn-start.mjs'],{input:JSON.stringify(input)});
 assert.equal(began.status,0,began.stderr||began.error?.message);
 assert(JSON.parse(began.stdout).hookSpecificOutput.additionalContext.includes('PROJECT_TASK_TREE_CHECKPOINT_V1'));
 const marker=JSON.parse(await readFile(path.join(fixture,'.task-tree-maintenance/turns/hook-runtime-1.json'),'utf8'));
 assert(!Object.keys(marker.baseline.files).some(file=>file.startsWith('.reports/')),'Ignored caches must not be scanned');assert.equal(marker.baseline.truncated,false);
 const normal=run(process.execPath,['.codex/hooks/stop-postflight.mjs'],{input:JSON.stringify({...input,hook_event_name:'Stop'})});
 assert.equal(normal.status,0,normal.stderr);assert.notEqual(JSON.parse(normal.stdout).decision,'block',normal.stdout);
 await writeFile(path.join(fixture,'app.mjs'),'export const changed = true;\n');
 const bad=run(process.execPath,['.codex/hooks/stop-postflight.mjs'],{input:JSON.stringify({...input,hook_event_name:'Stop'})});
 assert.equal(bad.status,0,bad.stderr);assert.equal(JSON.parse(bad.stdout).decision,'block','An unmaintained implementation change must be blocked');
 const evidence={projectHookStartup:true,normalStop:true,unmaintainedChangeBlocked:true,ignoredCacheExcluded:true,elapsedMs:Date.now()-start};
 await writeFile('.reports/project-hook-runtime.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await rm(fixture,{recursive:true,force:true});}
