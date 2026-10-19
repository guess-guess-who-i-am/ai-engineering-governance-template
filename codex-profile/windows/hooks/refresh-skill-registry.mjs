import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createWriteStream,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {codexRoot,runtimeConfig} from './graph-client.mjs';
import {metadataUnder,withAliases} from './skill-metadata.mjs';

async function run(command,args,modelCache){return await new Promise((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',SENTENCE_TRANSFORMERS_HOME:modelCache,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});const log=createWriteStream(path.join(codexRoot(),'skill-registry/build.log'),{flags:'a'});child.stderr.pipe(log);let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(new Error(`Graph build failed (${code}): ${stderr.slice(-3000)}`)));});}
async function atomic(file,text){const temporary=`${file}.${process.pid}.tmp`;await writeFile(temporary,text);await rename(temporary,file);}
export async function refreshForeground(root){
  const config=await runtimeConfig(root),home=path.dirname(root),directory=path.join(root,'skill-registry');
  const roots=[
    [path.join(home,'.agents/routed-skills'),'user',10],
    [path.join(home,'.agents/skills'),'user',11],
    [path.join(home,'.agents/deferred-skills'),'deferred',20],
    [path.join(root,'skills'),'system',20],
    [path.join(root,'deferred-skills/codex'),'deferred',30]
  ];
  const aliases=JSON.parse(await readFile(path.join(directory,'routing-rules.json'),'utf8'));
  const all=(await Promise.all(roots.map(([r,s,k])=>metadataUnder(r,s,k)))).flat();
  // System packages are nested one level below .system.
  all.push(...await metadataUnder(path.join(root,'skills/.system'),'system',20));
  const byName=new Map();for(const record of all){if(!byName.has(record.name))byName.set(record.name,record);}
  const skills=withAliases([...byName.values()],aliases);
  const catalogBytes=await readFile(config.catalog);
  const builder=await readFile(path.join(root,'hooks/graph_skill_index.py'));
  const digest=createHash('sha256').update(catalogBytes).update(JSON.stringify(skills)).update(builder).update(config.libraryRoot).digest('hex');
  const registryFile=path.join(directory,'skills-index.json');
  const current=await readFile(registryFile,'utf8').then(JSON.parse).catch(()=>null);
  if(current?.inputSha256===digest){return {status:'current',skillCount:skills.length,externalSkillCount:current.externalSkillCount};}
  await mkdir(directory,{recursive:true});
  const records=skills.map(r=>({...r,tool_name:'owned_'+createHash('sha256').update(r.path).digest('hex').slice(0,20),description:[r.name,r.description,...r.aliases].join(' '),categories:['owned'],tags:[]}));
  const recordFile=path.join(directory,`build-records.${process.pid}.json`);
  await writeFile(recordFile,JSON.stringify(records));
  const graphPath=path.join(directory,'skills.graph.json');
  const stdout=await run(config.python,[path.join(root,'hooks/graph_skill_index.py'),'build','--root',config.libraryRoot,'--catalog',config.catalog,'--records',recordFile,'--output',graphPath,'--embedding'],config.modelCache);
  const built=JSON.parse(stdout.trim());
  const registry={schemaVersion:'codex-unified-graph/1',generatedAt:new Date().toISOString(),inputSha256:digest,skillCount:skills.length,externalSkillCount:built.externalSkillCount,skills,graphPath};
  await atomic(registryFile,JSON.stringify(registry,null,2)+'\n');
  return {status:'rebuilt',skillCount:skills.length,externalSkillCount:registry.externalSkillCount};
}
async function main(){
  for await(const chunk of process.stdin){}
  if(process.env.CODEX_SKIP_EXTERNAL_INDEX_REFRESH==='1')return;
  const root=codexRoot();
  if(process.env.CODEX_SKILL_REGISTRY_FOREGROUND==='1'){
    const result=await refreshForeground(root);process.stderr.write(JSON.stringify(result)+'\n');return;
  }
  const config=await runtimeConfig(root),directory=path.join(root,'skill-registry');await mkdir(directory,{recursive:true});
  const log=await open(path.join(directory,'refresh.log'),'a');
  try{const child=spawn(config.python,[path.join(root,'hooks/graph_skill_index.py'),'refresh','--lock',path.join(directory,'private/refresh.lock'),'--node',process.execPath,'--script',fileURLToPath(import.meta.url)],{detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PYTHONUTF8:'1'}});child.on('error',e=>process.stderr.write(`Background refresh failed: ${e.message}\n`));child.unref();}finally{await log.close();}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){try{await main();process.stdout.write('{}');}catch(error){process.stderr.write(`Graph refresh failed: ${error.message}\n`);process.stdout.write('{}');process.exitCode=1;}}
