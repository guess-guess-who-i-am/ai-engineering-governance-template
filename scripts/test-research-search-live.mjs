// Opt-in acceptance through the installed stdio MCP and official upstream APIs.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry=process.argv[2]||path.join(root,'scripts/technical-research-mcp.mjs');
const output=process.argv[3]||path.join(root,'.reports/search-official-20261111/live.json');
const transport=new StdioClientTransport({command:process.execPath,args:[entry],stderr:'pipe'});
const stderr=[];transport.stderr?.on('data',chunk=>stderr.push(String(chunk)));
const client=new Client({name:'official-search-acceptance',version:'1.0.0'});
const queries=[
  {source:'github',query:'ripgrep',expectedUrl:'https://github.com/BurntSushi/ripgrep'},
  {source:'stackoverflow',query:'if else in a list comprehension',expectedUrl:'https://stackoverflow.com/questions/4260280/if-else-in-a-list-comprehension'},
  {source:'crossref',query:'The Tail at Scale',expectedUrl:'https://doi.org/10.1145/2408776.2408794'},
  {source:'openalex',query:'The Tail at Scale',expectedUrl:'https://doi.org/10.1145/2408776.2408794'},
];
try{
  await client.connect(transport);const tools=await client.listTools();const began=Date.now();
  const response=await client.callTool({name:'complementary_search_batch',arguments:{queries,cacheMode:'refresh',topK:5,selectedCount:20,concurrency:4,timeoutMs:20000}});
  const report=JSON.parse(response.content.find(c=>c.type==='text').text);
  const checks=report.operations.map((op,index)=>({source:queries[index].source,nonempty:op.returnedCount>0,targetHit:!op.targetMissing,
    authentication:op.branches.api.authentication,quota:op.branches.api.quota,error:op.branches.api.error,retryAt:op.branches.api.retryAt}));
  const officialOnly=report.operations.every(op=>!op.branches.web&&op.route.reason==='official-api-only')&&
    tools.tools.every(t=>!t.inputSchema.properties.queries.items.properties.source.enum.includes('web'));
  const passed=checks.slice(0,3).every(c=>c.nonempty&&c.targetHit)&&checks[0].authentication==='github-cli'&&checks[0].quota?.limit===30&&officialOnly;
  const result={entry,startedAt:new Date(began).toISOString(),elapsedMs:Date.now()-began,passed,scope:'GitHub authenticated + public Stack Exchange/Crossref known-target acceptance; OpenAlex separately reported',officialOnly,checks,stderr:stderr.join(''),response};
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output,passed,elapsedMs:result.elapsedMs,officialOnly,checks,status:report.status},null,2));
  if(!passed)process.exitCode=1;
}finally{await client.close();}
