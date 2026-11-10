#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TechnicalResearch, PROVIDERS } from './technical-research.mjs';
import { ComplementarySearch, SEARCH_SOURCES } from './complementary-search.mjs';

const service=new TechnicalResearch();
const complementary=new ComplementarySearch({technical:service});
const name='technical_research_batch';
const server=new Server({name:'technical-research',version:'1.2.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{
 name,
 description:'Batch technical research across Stack Overflow questions, GitHub repositories, OpenAlex papers and Crossref papers in one call. Use for software root-cause research, mature libraries, high-star repos, or paper discovery. Up to 20 independent queries, pooled HTTP, partial failures and full raw evidence artifacts. Omit optional fields unless needed; timeoutMs is 100–30000 milliseconds, default 8000. Use short focused API queries; long conjunctions can return nothing, and exact paper titles still require primary-source verification. cacheMode=refresh for current/live claims; prefer returns explicitly dated cached evidence within maxAgeSeconds. Not general web/news search, not full-paper verification, and CCF ranks are not inferred. Return selected cards, then inspect decisive primary sources.',
 inputSchema:{type:'object',additionalProperties:false,required:['queries'],properties:{
   queries:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,required:['source','query'],properties:{source:{type:'string',enum:PROVIDERS},query:{type:'string',minLength:1}}}},
   topK:{type:'integer',minimum:1,maximum:50,default:10},selectedCount:{type:'integer',minimum:1,maximum:100,default:16},
   cacheMode:{type:'string',enum:['prefer','refresh','only'],default:'prefer'},maxAgeSeconds:{type:'integer',minimum:0,maximum:86400,default:300},
   concurrency:{type:'integer',minimum:1,maximum:20,default:4},timeoutMs:{type:'integer',minimum:100,maximum:30000,default:8000,description:'Optional integer 100–30000 milliseconds; omit to use 8000. Shared batch budget including queue wait and HTTP work, not a new timeout for every query. Completed evidence is retained on timeout.'}
 }},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}
},{
 name:'complementary_search_batch',
 description:'互补批量搜索：技术资料、GitHub仓库、Stack Overflow、论文与中文网页。Complement free technical APIs with the existing keyless IDE web search. English repo/SO API first, supplement only errors/empty/missing explicit target; Chinese web first unless apiQuery supplies English; papers use scholarly API plus web concurrently. Select this entry for mixed discovery; technical_research_batch is API-only. Up to 20 independent operations; no paid fallback/translation. Results are candidates, not verified answers. Read original sources. If local free web is unavailable, inspect partial results then supplement missing directions with session web tools. User-forbidden networking takes precedence; cacheMode=only makes no HTTP requests.',
 inputSchema:{type:'object',additionalProperties:false,required:['queries'],properties:{
   queries:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,required:['source','query'],properties:{
     source:{type:'string',enum:SEARCH_SOURCES},query:{type:'string',minLength:1},apiQuery:{type:'string',minLength:1,description:'Optional caller-supplied English API query; original query is retained for web.'},
     expectedTitle:{type:'string',minLength:1},expectedUrl:{type:'string',minLength:1}}}},
   topK:{type:'integer',minimum:1,maximum:15,default:10},selectedCount:{type:'integer',minimum:1,maximum:100,default:16},
   cacheMode:{type:'string',enum:['prefer','refresh','only'],default:'prefer'},maxAgeSeconds:{type:'integer',minimum:0,maximum:86400,default:300},
   concurrency:{type:'integer',minimum:1,maximum:20,default:8},timeoutMs:{type:'integer',minimum:100,maximum:30000,default:12000,description:'One shared deadline; API-first phase uses at most half so the web supplement has remaining time.'}
 }},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}
}]}));
server.setRequestHandler(CallToolRequestSchema,async request=>{
 if(![name,'complementary_search_batch'].includes(request.params.name))return {isError:true,content:[{type:'text',text:'Unknown tool'}]};
 try{
   if(request.params.name==='complementary_search_batch'){
     const result=await complementary.batch(request.params.arguments||{});
     const compact={...result,operations:result.operations.map(({results,branches,...op})=>({...op,returnedCount:results.length,
       branches:Object.fromEntries(Object.entries(branches).map(([key,{results,...branch}])=>[key,{...branch,returnedCount:results.length}]))}))};
     return {isError:result.status==='error',content:[{type:'text',text:JSON.stringify(compact)}]};
   }
   const result=await service.batch(request.params.arguments||{});
   // The raw candidate pool stays in artifacts. Only task-relevant selected cards enter model context.
   const compact={...result,operations:result.operations.map(({results,...operation})=>operation)};
   // Partial evidence is usable. A single provider failure must not turn the
   // entire result into a tool failure and encourage repeating every query.
   return {isError:result.successfulOperations===0&&result.status!=='ok',content:[{type:'text',text:JSON.stringify(compact)}]};
 }catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify({status:'error',error:error.message,
   ...(error.code==='INVALID_ARGUMENT'?{code:error.code,field:error.field,minimum:error.minimum,maximum:error.maximum}: {})})}]};}
});
await server.connect(new StdioServerTransport());
