#!/usr/bin/env node
// Stable stdio adapter; shared state and implementation live in one service.
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {setTimeout as delay} from 'node:timers/promises';
const base=new URL(process.env.CODEX_RESEARCH_BASE_URL||'http://127.0.0.1:3211');
if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('Research service must use a loopback HTTP origin');
async function rpc(route,body,budget=3000){
  const deadline=performance.now()+budget;
  for(let attempt=0;;attempt++){
    try{
      const response=await fetch(new URL(route,base),{method:body?'POST':'GET',redirect:'error',
        ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(Math.max(1,Math.floor(deadline-performance.now())))});
      const result=await response.json();
      if(!response.ok)throw new Error(`Resident research service HTTP ${response.status}: ${result.error||'unavailable'}`);
      return result;
    }catch(error){
      const remaining=deadline-performance.now(),pause=Math.min(600,150*2**Math.min(attempt,2));
      if(!['ECONNREFUSED','ECONNRESET','UND_ERR_SOCKET'].includes(error.cause?.code)||remaining<=pause)throw error;
      await delay(pause);
    }
  }
}
const server=new Server({name:'technical-research',version:'2.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,()=>rpc('/tools'));
server.setRequestHandler(CallToolRequestSchema,async request=>{
  try{
    const configured=request.params.arguments?.timeoutMs;
    const budget=Number.isInteger(configured)&&configured>=100&&configured<=30000?configured+2000:32000;
    return await rpc('/call',request,budget);
  }catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify({status:'error',error:error.message,hint:'Inspect the user-level research LaunchAgent and /status. No separate API worker or paid source was started.'})}]};}
});
await server.connect(new StdioServerTransport());
