#!/usr/bin/env node
import http from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {toolDefinitions,executeTool} from './research-tools.mjs';

const script=path.dirname(fileURLToPath(import.meta.url));
const inputs=['research-service.mjs','research-tools.mjs','technical-research.mjs','complementary-search.mjs','research-concurrency.mjs','research-credentials.mjs'];
const digest=createHash('sha256');for(const file of inputs)digest.update(await readFile(path.join(script,file)));
const revision=digest.digest('hex'),instance=randomUUID(),startedAt=new Date().toISOString();
let active=0,peak=0;
const send=(res,status,value)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}};
const server=http.createServer(async(req,res)=>{
  if(req.headers.origin){send(res,403,{error:'Cross-origin calls are not allowed'});return;}
  if(req.method==='GET'&&req.url==='/status'){send(res,200,{status:'ok',instance,revision,pid:process.pid,startedAt,activeRequests:active,peakRequests:peak});return;}
  if(req.method==='GET'&&req.url==='/tools'){send(res,200,{tools:toolDefinitions});return;}
  if(req.method!=='POST'||req.url!=='/call'){send(res,404,{error:'Unknown research endpoint'});return;}
  if(active>=256){res.setHeader('retry-after','1');send(res,503,{error:'Research request capacity exceeded; retry later'});return;}
  active++;peak=Math.max(peak,active);
  try{
    let bytes=0;const chunks=[];
    for await(const chunk of req){bytes+=chunk.length;if(bytes>262144){send(res,413,{error:'Research request exceeds 256KiB'});return;}chunks.push(chunk);}
    let request;try{request=JSON.parse(Buffer.concat(chunks));}catch{send(res,400,{error:'Invalid JSON'});return;}
    if(typeof request?.params?.name!=='string'){send(res,400,{error:'Missing tool name'});return;}
    send(res,200,await executeTool(request));
  }catch(error){send(res,500,{error:error.message});}finally{active--;}
});
server.requestTimeout=35000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
const port=Number(process.env.CODEX_RESEARCH_PORT||3211);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid research port');
server.listen(port,'127.0.0.1',()=>console.error(JSON.stringify({service:'global-research',port,pid:process.pid,revision})));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
  server.close(()=>process.exit(0));setTimeout(()=>{server.closeAllConnections();process.exit(0);},32000).unref();
});
