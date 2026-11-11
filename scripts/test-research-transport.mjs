import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';

async function fixture(t){
  const server=http.createServer((req,res)=>{
    req.resume();res.setHeader('content-type','application/json');
    res.end(JSON.stringify(req.url==='/tools'?{tools:[]}:{content:[{type:'text',text:'recovered'}]}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;
  const client=new Client({name:'transport-regression',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./technical-research-mcp.mjs',import.meta.url))],
    env:{CODEX_RESEARCH_BASE_URL:'http://127.0.0.1:'+port},stderr:'pipe'});
  let stderr='';transport.stderr.on('data',b=>stderr+=b);
  t.after(async()=>{await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(stderr,'');});
  await client.connect(transport);
  return {server,client,port};
}

test('existing MCP connection waits through a delayed resident restart',async t=>{
  const {server,client,port}=await fixture(t);
  await client.listTools();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const timer=setTimeout(()=>server.listen(port,'127.0.0.1'),700);t.after(()=>clearTimeout(timer));
  const result=await client.callTool({name:'technical_research_batch',arguments:{timeoutMs:1500}});
  assert.notEqual(result.isError,true,JSON.stringify(result));
  assert.equal(result.content[0].text,'recovered');
  assert.deepEqual((await client.listTools()).tools,[]);
});

test('resident HTTP failures are surfaced without repeating completed work',async t=>{
  const {server,client}=await fixture(t);let calls=0;
  server.removeAllListeners('request');server.on('request',(req,res)=>{calls++;req.resume();res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'fixture failure'}));});
  const result=await client.callTool({name:'technical_research_batch',arguments:{timeoutMs:100}});
  assert.equal(result.isError,true);assert.match(result.content[0].text,/HTTP 500/);assert.equal(calls,1);
});
