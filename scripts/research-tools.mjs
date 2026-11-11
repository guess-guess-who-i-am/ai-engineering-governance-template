import { TechnicalResearch, PROVIDERS } from './technical-research.mjs';
import { ComplementarySearch, SEARCH_SOURCES } from './complementary-search.mjs';

const service=new TechnicalResearch();
const complementary=new ComplementarySearch({technical:service});
const name='technical_research_batch';
export const toolDefinitions=[{
 name,
 description:'Batch technical research across Stack Overflow questions, GitHub repositories, OpenAlex papers and Crossref paper titles in one call. Use for software root-cause research, mature libraries, high-star repos, or paper discovery. Up to 20 independent queries, shared pacing, quota metadata, pooled HTTP and partial failures. Official APIs only. Reuses GitHub CLI credentials in memory; credentials never enter request URLs or evidence. Quotas still apply. Omit optional fields unless needed; timeoutMs is 100–30000 milliseconds, default 8000. Use short focused API queries; original query and actual requestQuery are reported. GitHub searches name/description/README unless in: is explicit; this is NOT arbitrary source code search. Empty operations are status=empty and are not counted as successful discoveries. Exact paper titles still require primary-source verification. cacheMode=refresh for current/live claims; prefer returns explicitly dated cached evidence within maxAgeSeconds. Not general web/news search, not full-paper verification, and CCF ranks are not inferred. Return selected cards, then inspect decisive primary sources.',
 inputSchema:{type:'object',additionalProperties:false,required:['queries'],properties:{
   queries:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,required:['source','query'],properties:{source:{type:'string',enum:PROVIDERS},query:{type:'string',minLength:1}}}},
   topK:{type:'integer',minimum:1,maximum:50,default:10},selectedCount:{type:'integer',minimum:1,maximum:100,default:16},
   cacheMode:{type:'string',enum:['prefer','refresh','only'],default:'prefer'},maxAgeSeconds:{type:'integer',minimum:0,maximum:86400,default:300},
   concurrency:{type:'integer',minimum:1,maximum:20,default:4},timeoutMs:{type:'integer',minimum:100,maximum:30000,default:8000,description:'Optional integer 100–30000 milliseconds; omit to use 8000. Shared batch budget including queue wait and HTTP work, not a new timeout for every query. Completed evidence is retained on timeout.'}
 }},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}
},{
 name:'complementary_search_batch',
 description:'Official API batch discovery for GitHub repositories, Stack Overflow questions and papers. No web scraping or local corpus. papers maps to Crossref title search; OpenAlex is an explicit separate source. Use short apiQuery for Chinese or lengthy questions. Reuses GitHub CLI login; Stack Exchange and OpenAlex optionally use official keys from the user credential store. Shared origin pacing, quotas, cooldowns and in-flight coalescing apply across all workspaces. Up to 20 independent operations; quotas can require retryAt rather than immediate dispatch. Inspect branch errors and actual quota; never promise unlimited requests. Metadata and target matches are candidates, not verified answers.',
 inputSchema:{type:'object',additionalProperties:false,required:['queries'],properties:{
   queries:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,required:['source','query'],properties:{
     source:{type:'string',enum:SEARCH_SOURCES},query:{type:'string',minLength:1},apiQuery:{type:'string',minLength:1,description:'Optional short caller-supplied English API query; original question is retained for provenance. Prefer 2–4 distinctive terms over a long natural-language conjunction.'},
     expectedTitle:{type:'string',minLength:1},expectedUrl:{type:'string',minLength:1}}}},
   topK:{type:'integer',minimum:1,maximum:15,default:10},selectedCount:{type:'integer',minimum:1,maximum:100,default:16},
   cacheMode:{type:'string',enum:['prefer','refresh','only'],default:'prefer'},maxAgeSeconds:{type:'integer',minimum:0,maximum:86400,default:300},
   concurrency:{type:'integer',minimum:1,maximum:20,default:8},timeoutMs:{type:'integer',minimum:100,maximum:30000,default:12000,description:'One shared deadline includes credentials, queue wait, pacing and HTTP work.'}
 }},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}
}];
export async function executeTool(request){
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
   return {isError:result.status==='error',content:[{type:'text',text:JSON.stringify(compact)}]};
 }catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify({status:'error',error:error.message,
   ...(error.code==='INVALID_ARGUMENT'?{code:error.code,field:error.field,minimum:error.minimum,maximum:error.maximum}: {})})}]};}
}
