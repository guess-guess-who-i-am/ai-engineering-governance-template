#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TechnicalResearch, PROVIDERS } from './technical-research.mjs';

const service=new TechnicalResearch();
const name='technical_research_batch';
const server=new Server({name:'technical-research',version:'1.1.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{
 name,
 description:'Batch technical research across Stack Overflow questions, GitHub repositories, OpenAlex papers and Crossref papers in one call. Use for software root-cause research, mature libraries, high-star repos, or paper discovery. Up to 20 independent queries, pooled HTTP, partial failures and full raw evidence artifacts. Use short focused API queries; long conjunctions can return nothing, and exact paper titles still require primary-source verification. cacheMode=refresh for current/live claims; prefer returns explicitly dated cached evidence within maxAgeSeconds. Not general web/news search, not full-paper verification, and CCF ranks are not inferred. Return selected cards, then inspect decisive primary sources.',
 inputSchema:{type:'object',additionalProperties:false,required:['queries'],properties:{
   queries:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,required:['source','query'],properties:{source:{type:'string',enum:PROVIDERS},query:{type:'string',minLength:1}}}},
   topK:{type:'integer',minimum:1,maximum:50,default:10},selectedCount:{type:'integer',minimum:1,maximum:100,default:16},
   cacheMode:{type:'string',enum:['prefer','refresh','only'],default:'prefer'},maxAgeSeconds:{type:'integer',minimum:0,maximum:86400,default:300},
   concurrency:{type:'integer',minimum:1,maximum:20,default:4},timeoutMs:{type:'integer',minimum:100,maximum:30000,default:8000,description:'Shared batch budget including queue wait and HTTP work, not a new timeout for every query. Completed evidence is retained on timeout.'}
 }},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}
}]}));
server.setRequestHandler(CallToolRequestSchema,async request=>{
 if(request.params.name!==name)return {isError:true,content:[{type:'text',text:'Unknown tool'}]};
 try{
   const result=await service.batch(request.params.arguments||{});
   // The raw candidate pool stays in artifacts. Only task-relevant selected cards enter model context.
   const compact={...result,operations:result.operations.map(({results,...operation})=>operation)};
   // Partial evidence is usable. A single provider failure must not turn the
   // entire result into a tool failure and encourage repeating every query.
   return {isError:result.successfulOperations===0&&result.status!=='ok',content:[{type:'text',text:JSON.stringify(compact)}]};
 }catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify({status:'error',error:error.message})}]};}
});
await server.connect(new StdioServerTransport());
