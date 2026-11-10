#!/usr/bin/env node
// Live IDE consumer test: status -> discovery -> full original expert/Skill read.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{'ide-runtime':{type:'string'},output:{type:'string'}}});
assert(values['ide-runtime']);
const {createAgentRuntime}=await import(pathToFileURL(path.resolve(values['ide-runtime'])));
const home=os.homedir(),root=path.join(home,'.codex');
const catalog=JSON.parse(await readFile(path.join(root,'skill-registry/resource-modules.json')));
const modules=['dev-pipeline-orchestrator','performance-testing-expert','budget-balance','context7'].map(name=>{
 const rows=catalog.modules.filter(m=>m.name===name);assert.equal(rows.length,1);return rows[0];
});
const manifest=JSON.parse(await readFile(path.join(root,'skill-registry/external-skills-manifest.json')));
const external=JSON.parse(await readFile(manifest.catalogPath));
const sample=external.skills[0];
const temp=await mkdtemp(path.join(os.tmpdir(),'global-resource-consumers-'));
try{
 const rows=await Promise.all([0,1].map(async index=>{
  const cwd=path.join(temp,'workspace-'+index);await mkdir(cwd);
  const runtime=await createAgentRuntime({cwd,homeDir:home,codexHome:root,treeBridgeFactory:async()=>({tools:[],instructions:'',close:async()=>{}})});
  const started=Date.now();
  try{
   const results=[];
   for(const m of modules){
    const discovered=await runtime.call('skills_list',{query:m.name});
    assert(discovered.skills.some(row=>row.id===m.id),'IDE cannot discover '+m.id);
    const exact=await runtime.call('skills_read',{name:m.id});
    assert.equal(exact.content,await readFile(m.path,'utf8'));assert.equal(exact.source,'global-resource');
    if(m.kind==='expert')assert(exact.content.includes('[EXPERT_ENTRY_V1: ORIGINAL_ROLE_LOADED]'));
    results.push({id:m.id,bytes:Buffer.byteLength(exact.content),source:exact.source});
   }
   const skill=await runtime.call('skills_read',{name:path.join(manifest.rootPath,sample.dir,'SKILL.md')});
   assert.equal(skill.source,'external-library');assert.equal(skill.content,await readFile(skill.path,'utf8'));
   const hasStatus=runtime.tools.some(t=>t.function?.name==='global_config_status');
   const status=hasStatus?await runtime.call('global_config_status',{}):null;
   if(status)assert.equal(status.resources.experts.registered,447);
   return {cwd,started,ended:Date.now(),passed:true,results,externalRead:true,statusSupported:hasStatus,experts:status?.resources.experts.registered};
  }finally{await runtime.close()}
 }));
 const result={passed:true,runtime:values['ide-runtime'],rows,modelWorkflowExecuted:false};
 if(values.output)await writeFile(values.output,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{await rm(temp,{recursive:true,force:true})}
