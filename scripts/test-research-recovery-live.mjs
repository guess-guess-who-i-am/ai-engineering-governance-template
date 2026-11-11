// Explicit live fault injection: restarts only the managed official search service.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const run=promisify(execFile),delay=ms=>new Promise(r=>setTimeout(r,ms));
if(process.platform!=='darwin')throw new Error('This opt-in test requires the current macOS user LaunchAgents');
const entry=path.join(os.homedir(),'.codex/tools/complementary-search/scripts/technical-research-mcp.mjs');
const output=process.argv[2]||'.reports/search-stability-20261111/recovery-live.json';
const report={startedAt:new Date().toISOString(),entry,checks:[],passed:false},clients=[];
async function status(port){const r=await fetch('http://127.0.0.1:'+port+'/status',{signal:AbortSignal.timeout(1000)});assert.ok(r.ok);return r.json();}
async function ready(port,oldInstance){
  const began=performance.now();let last;
  while(performance.now()-began<12000){
    try{const r=await status(port);if(r.status==='ok'&&(!oldInstance||r.instance!==oldInstance))return {elapsedMs:performance.now()-began,status:r};}catch(error){last=error.message;}
    await delay(100);
  }
  throw new Error('Search service recovery timed out: '+port+' '+last);
}
function parse(r){assert.notEqual(r.isError,true,JSON.stringify(r));return JSON.parse(r.content.find(x=>x.type==='text').text);}
try{
  for(let i=0;i<5;i++){
    const transport=new StdioClientTransport({command:process.execPath,args:[entry],stderr:'pipe'});
    const client=new Client({name:'recovery-live-'+i,version:'1'});let stderr='';transport.stderr.on('data',b=>stderr+=b);
    await client.connect(transport);clients.push({client,transport,stderr:()=>stderr});assert.equal((await client.listTools()).tools.length,2);
  }
  const service=await status(3211);
  const started=performance.now(),spans=[];
  const results=await Promise.all(Array.from({length:100},async(_,i)=>{
    const began=performance.now();
    const r=parse(await clients[i%5].client.callTool({name:'technical_research_batch',arguments:{queries:[{source:'stackoverflow',query:'javascript array map'}],topK:3,cacheMode:'refresh',timeoutMs:12000}}));
    spans.push({index:i,startMs:began-started,endMs:performance.now()-started});assert.equal(r.successfulOperations,1,JSON.stringify(r));return r;
  }));
  const requestIds=[...new Set(results.flatMap(r=>r.operations.map(o=>o.network?.requestId)))];
  assert.equal(requestIds.length,1,'Identical concurrent requests must share one upstream request');
  const events=spans.flatMap(s=>[[s.startMs,1],[s.endMs,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,peak=0;
  for(const [,delta]of events){active+=delta;peak=Math.max(peak,active);}
  const adapterPids=clients.map(c=>c.transport.pid);assert.equal(new Set(adapterPids).size,5);assert.equal(peak,100);
  report.checks.push({name:'100 live requests through 5 separate MCP processes',passed:true,elapsedMs:performance.now()-started,adapterPids,peakClientOverlap:peak,upstreamRequestIds:requestIds,spans});
  const recoveryBegan=performance.now();
  await run('/bin/launchctl',['kill','SIGKILL','gui/'+process.getuid()+'/com.codex.research']);
  const duringRestart=parse(await clients[0].client.callTool({name:'technical_research_batch',arguments:{queries:[{source:'stackoverflow',query:'javascript array map'}],topK:3,cacheMode:'only',timeoutMs:10000}}));
  assert.equal(duringRestart.cacheHits,1);const recovered=await ready(3211,service.instance);
  assert.notEqual(recovered.status.pid,service.pid);
  report.checks.push({name:'resident SIGKILL and original MCP connection recovery',passed:true,...recovered,elapsedSinceKillMs:performance.now()-recoveryBegan});
  assert.equal((await clients[0].client.listTools()).tools.length,2);
  report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
  for(const {client}of clients)await client.close();report.stderr=clients.map(c=>c.stderr());
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,passed:report.passed,error:report.error,checks:report.checks.map(({spans,operations,...c})=>c)},null,2));
}
