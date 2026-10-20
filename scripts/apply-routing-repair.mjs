import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {stagePolicyUpdates,registerTaskTreeRuntime,prepareRoutingIndex,adaptTaskTreeInstaller,adaptWorker,adaptRouter,adaptRefresh,adaptDispatcher,adaptInstaller} from './install-mac-profile-on-windows.mjs';
import {ensureWarmWorker} from './prewarm-mac-worker.mjs';

const root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const manifest=JSON.parse(await readFile(path.join(root,'skill-registry/mac-source.json'),'utf8'));
const previous=await readFile(path.join(manifest.nativeSource,'scripts/install-codex-profile-mac.mjs'),'utf8');
const agentsHash=previous.match(/sha256\(currentAgents\) === "([a-f0-9]{64})"/)?.[1];
if(!agentsHash)throw new Error('Original managed AGENTS boundary is unavailable');
const backup=path.join(root,'backups/routing-policy',new Date().toISOString().replace(/[-:]/g,''));
await mkdir(backup,{recursive:true});
await copyFile(path.join(root,'skill-registry/mac-source.json'),path.join(backup,'mac-source.json'));
try{await copyFile(path.join(root,'skill-registry/task-tree-runtime.json'),path.join(backup,'task-tree-runtime.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
const policy=await stagePolicyUpdates(root,manifest.nativeSource);
await copyFile(new URL('./mac-windows-transport.mjs',import.meta.url),path.join(manifest.nativeSource,'codex-profile/mac/hooks/mac-windows-transport.mjs'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const transformations=[['codex-profile/mac/hooks/graph_skill_index.py',adaptWorker],['codex-profile/.codex/hooks/skill-router.mjs',adaptRouter],['codex-profile/mac/hooks/refresh-skill-registry.mjs',adaptRefresh],['codex-profile/.codex/hooks/hook-dispatch.mjs',adaptDispatcher],['scripts/install-codex-profile-mac.mjs',text=>adaptInstaller(text,agentsHash)],['scripts/install-task-tree-mcp-mac.mjs',adaptTaskTreeInstaller]];
manifest.adaptations=[];
for(const [file,transform] of transformations){
 const original=await readFile(path.join(manifest.source,file),'utf8');
 const policyFile=policy.policyFiles.some(item=>item.file===file)?path.join(policy.policySource,file):path.join(manifest.source,file);
 const input=await readFile(policyFile,'utf8');const output=transform(input);
 await writeFile(path.join(manifest.nativeSource,file),output);
 manifest.adaptations.push({file,upstreamSha256:sha(original),policySha256:sha(input),nativeSha256:sha(output)});
}
Object.assign(manifest,policy);
await writeFile(path.join(root,'skill-registry/mac-source.json'),JSON.stringify(manifest,null,2)+'\n');
const env={...process.env,CODEX_HOME:root,CODEX_EXTERNAL_SKILL_ROOT:manifest.library,CODEX_EXTERNAL_SKILL_CATALOG:path.join(manifest.library,'_catalog_cn.json'),CODEX_PROFILE_SKILL_SOURCE:manifest.library,CODEX_GRAPH_TOOL_PYTHON:manifest.python,SENTENCE_TRANSFORMERS_HOME:manifest.modelCache,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHONUTF8:'1',OMP_NUM_THREADS:'4',MKL_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4'};
await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(manifest.nativeSource,'scripts/install-codex-profile-mac.mjs'),'--json'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>process.stdout.write(chunk));child.stderr.on('data',chunk=>process.stderr.write(chunk));child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Policy installation failed with exit '+code)));
});
console.log(JSON.stringify({phase:'policy-installed',revision:policy.policyRevision,baselineUnmodified:true}));
await registerTaskTreeRuntime(root);
await copyFile(path.join(manifest.nativeSource,'scripts/parallel-run.mjs'),path.join(root,'tools/parallel-run.mjs'));
await prepareRoutingIndex(root,manifest);
console.log(JSON.stringify({phase:'worker-ready',...await ensureWarmWorker(root)}));
