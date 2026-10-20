// Platform-only bridge for the unmodified macOS GraphToolCall routing policy.
// No scoring, embeddings, candidate gating, or prompt text belongs here.
import {createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,openSync,closeSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function workerSocketPath(graphPath){
  const root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  return path.join(root,'skill-registry','mac-private',createHash('sha256').update(graphPath).digest('hex').slice(0,24)+'.json');
}
export function requestGraphWorker(socketPath,payload,timeoutMs){
  return requestGraphWorkerRaw(socketPath,payload,timeoutMs).then(response=>response.results||[]);
}
export function requestGraphWorkerRaw(socketPath,payload,timeoutMs){
  return new Promise((resolve,reject)=>{
    let endpoint;try{endpoint=JSON.parse(readFileSync(socketPath,'utf8'));}catch(error){reject(error);return;}
    if(endpoint.host!=='127.0.0.1'||!Number.isInteger(endpoint.port)||typeof endpoint.token!=='string')return reject(new Error('Invalid private worker endpoint'));
    const socket=createConnection({host:endpoint.host,port:endpoint.port});let buffer='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error(`GraphToolCall worker timed out after ${timeoutMs}ms`)),timeoutMs);
    socket.setEncoding('utf8');socket.on('connect',()=>socket.write(JSON.stringify({...payload,_token:endpoint.token})+'\n'));
    socket.on('data',chunk=>{buffer+=chunk;const newline=buffer.indexOf('\n');if(newline<0)return;try{const response=JSON.parse(buffer.slice(0,newline));if(!response.ok)throw new Error(response.error||'GraphToolCall worker failed');finish(null,response);}catch(error){finish(error);}});
    socket.on('error',error=>finish(error));socket.on('close',()=>finish(Object.assign(new Error('GraphToolCall worker closed the connection'),{code:'ECONNRESET'})));
  });
}
export function startGraphWorker(graphPath,pythonPath,indexerPath,socketPath){
  const root=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  const log=openSync(path.join(root,'skill-registry/mac-worker.log'),'a');
  try{
    const child=spawn(pythonPath,[indexerPath,'serve','--graph',graphPath,'--socket',socketPath,'--idle-timeout',String(Number(process.env.CODEX_GRAPH_TOOL_WORKER_IDLE_SECONDS||0))],{
      detached:true,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,PYTHONUNBUFFERED:'1',PYTHONUTF8:'1',SENTENCE_TRANSFORMERS_HOME:path.join(root,'tools/embedding-models')}
    });
    child.on('error',error=>process.stderr.write(`GraphToolCall startup failed: ${error.message}\n`));child.unref();
  }finally{closeSync(log);}
}
