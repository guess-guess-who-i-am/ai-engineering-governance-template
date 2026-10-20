import {readFile,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workerSocketPath,requestGraphWorkerRaw,startGraphWorker} from './mac-windows-transport.mjs';

export async function ensureWarmWorker(root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),{start=true}={}){
 const manifest=JSON.parse(await readFile(path.join(root,'skill-registry/mac-source.json'),'utf8'));
 const graph=await realpath(path.join(root,'skill-registry/skills.graph.json'));
 const endpoint=workerSocketPath(graph),deadline=Date.now()+240000;
 let started=false;
 while(Date.now()<deadline){
  try{
   const status=await requestGraphWorkerRaw(endpoint,{_op:'status',deadline:Date.now()+5000},5000);
   if(!status.ready||status.warmWorkers?.length!==4)throw new Error('Worker must report four fully loaded retrieval processes');
   return {ready:true,supervisorPid:status.pid,workers:status.warmWorkers};
  }catch(error){
   if(!['ENOENT','ECONNREFUSED','ECONNRESET'].includes(error.code))throw error;
   if(!start)throw error;
   if(!started){startGraphWorker(graph,manifest.python,path.join(root,'hooks/graph_skill_index.py'),endpoint);started=true;}
   await new Promise(resolve=>setTimeout(resolve,200));
  }
 }
 throw new Error('Four-process warm-up did not become ready within 240 seconds');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===await realpath(process.argv[1])){
 try{console.log(JSON.stringify(await ensureWarmWorker()));}catch(error){console.error(error.message);process.exitCode=1;}
}
