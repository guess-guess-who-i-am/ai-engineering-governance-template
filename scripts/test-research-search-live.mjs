// Opt-in live acceptance through the real stdio MCP entry. No credentials.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry=process.argv[2]||path.join(root,'scripts/technical-research-mcp.mjs');
const output=process.argv[3]||path.join(root,'.reports/search-repair-20261111/live-local.json');
const transport=new StdioClientTransport({command:process.execPath,args:[entry],stderr:'pipe'});
const stderr=[];transport.stderr?.on('data',chunk=>stderr.push(String(chunk)));
const client=new Client({name:'search-repair-acceptance',version:'1.0.0'});
const queries=[
  {source:'github',query:'ripgrep',expectedUrl:'https://github.com/BurntSushi/ripgrep'},
  {source:'stackoverflow',query:'python list comprehension',expectedUrl:'https://stackoverflow.com/questions/4260280/if-else-in-a-list-comprehension'},
  {source:'github',query:'MCP tools/list_changed client cache invalidation implementation'},
  {source:'github',query:'MCP tools/list_changed client cache invalidation implementation',apiQuery:'"tools/list_changed" MCP'},
  {source:'stackoverflow',query:'MCP tools list changed notification refresh cache'},
  {source:'papers',query:'Attention Is All You Need',expectedUrl:'https://arxiv.org/abs/1706.03762'},
  {source:'openalex',query:'The Tail at Scale',expectedUrl:'https://doi.org/10.1145/2408776.2408794'},
  {source:'web',query:'GitHub ripgrep 命令行搜索'},
  {source:'web',query:'"zzNoSuchPaper1794386xQuux"',expectedTitle:'zzNoSuchPaper1794386xQuux'},
];
try{
  await client.connect(transport);
  const tools=await client.listTools();
  const began=Date.now();
  const response=await client.callTool({name:'complementary_search_batch',arguments:{queries,cacheMode:'refresh',topK:5,selectedCount:60,concurrency:6,timeoutMs:20000}});
  const report=JSON.parse(response.content.find(c=>c.type==='text').text);
  const required=[0,1,5,6,7];
  const checks=required.map(index=>({index,source:queries[index].source,nonempty:report.operations[index].returnedCount>0,
    targetHit:queries[index].expectedUrl?!report.operations[index].targetMissing:null}));
  const emptyResponse=await client.callTool({name:'technical_research_batch',arguments:{queries:[{source:'stackoverflow',query:queries[4].query}],topK:5,cacheMode:'only'}});
  const empty=JSON.parse(emptyResponse.content.find(c=>c.type==='text').text);
  const emptyCachePassed=!emptyResponse.isError&&empty.status==='empty'&&empty.emptyOperations===1&&empty.successfulOperations===0&&empty.cacheHits===1;
  const passed=checks.every(c=>c.nonempty&&c.targetHit!==false)&&report.operations[8].targetMissing===true&&emptyCachePassed;
  const result={entry,startedAt:new Date(began).toISOString(),elapsedMs:Date.now()-began,tools:tools.tools.map(t=>t.name),passed,checks,emptyCachePassed,emptyResponse,stderr:stderr.join(''),response};
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({entry,output,passed,elapsedMs:result.elapsedMs,checks,operations:report.operations,selected:report.selected.map(c=>({title:c.title,url:c.url}))},null,2));
  if(!passed)process.exitCode=1;
}finally{await client.close();}
