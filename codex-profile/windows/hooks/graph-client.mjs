import {createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {readFile,open,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const codexRoot = () => process.env.CODEX_HOME || path.join(os.homedir(),'.codex');
export async function runtimeConfig(root=codexRoot()) {
  return JSON.parse(await readFile(path.join(root,'skill-registry/graph-runtime.json'),'utf8'));
}
export async function graphRequest(payload,{root=codexRoot(),timeoutMs=55000,start=true}={}) {
  const endpointFile=path.join(root,'skill-registry/private/graph-endpoint.json');
  const deadline=Date.now()+timeoutMs;
  let lastStart=0,lastError;
  while(Date.now()<deadline){
    try {
      const endpoint=JSON.parse(await readFile(endpointFile,'utf8'));
      if(endpoint.schemaVersion!=='codex-graph-endpoint/1'||endpoint.host!=='127.0.0.1'||!Number.isInteger(endpoint.port)) throw new Error('Invalid graph endpoint');
      return await request(endpoint,{...payload,deadline,token:endpoint.token},Math.max(1,deadline-Date.now()));
    } catch(error) {
      if(!['ENOENT','ECONNREFUSED','ECONNRESET'].includes(error.code)) throw error;
      lastError=error;
      if(!start) throw error;
      if(Date.now()-lastStart>2000){
        const config=await runtimeConfig(root);
        await mkdir(path.dirname(endpointFile),{recursive:true});
        const log=await open(path.join(root,'skill-registry/worker.log'),'a');
        try {
          const child=spawn(config.python,[path.join(root,'hooks/graph_skill_index.py'),'serve','--graph',path.join(root,'skill-registry/skills.graph.json'),'--endpoint',endpointFile,'--processes',String(config.processes||2)],{detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PYTHONUTF8:'1',SENTENCE_TRANSFORMERS_HOME:config.modelCache,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
          child.on('error',e=>process.stderr.write(`Graph worker startup failed: ${e.message}\n`));child.unref();
        } finally {await log.close();}
        lastStart=Date.now();
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  throw new Error(`Graph worker unavailable: ${lastError?.message||'deadline exceeded'}`);
}
function request(endpoint,payload,timeoutMs){
  return new Promise((resolve,reject)=>{
    const socket=createConnection({host:endpoint.host,port:endpoint.port});let buffer='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('Graph retrieval deadline exceeded')),timeoutMs);
    socket.setEncoding('utf8');socket.on('connect',()=>socket.write(JSON.stringify(payload)+'\n'));
    socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>4*1024*1024)return finish(new Error('Graph response exceeds safety budget'));const newline=buffer.indexOf('\n');if(newline<0)return;try{const value=JSON.parse(buffer.slice(0,newline));if(!value.ok)throw new Error(value.error||'Graph request failed');finish(null,value);}catch(error){finish(error);}});
    socket.on('error',error=>finish(error));socket.on('close',()=>finish(Object.assign(new Error('Graph connection closed'),{code:'ECONNRESET'})));
  });
}
