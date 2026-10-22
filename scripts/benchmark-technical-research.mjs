import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { TechnicalResearch } from './technical-research.mjs';

const queries=[
 {source:'stackoverflow',query:'aiohttp ClientSession'},
 {source:'stackoverflow',query:'aiohttp connection pool'},
 {source:'github',query:'metasearch stars:>1000'},
 {source:'github',query:'http client connection pooling stars:>1000'},
 {source:'openalex',query:'An LLM Compiler for Parallel Function Calling'},
 {source:'openalex',query:'The Tail at Scale'},
 {source:'crossref',query:'The tail at scale Dean Barroso'},
 {source:'crossref',query:'An LLM Compiler for Parallel Function Calling'}
];
const client=new TechnicalResearch(),samples=[];
for(const cacheMode of process.argv.includes('--cache-only')?['only']:['refresh','prefer','only']){
 const began=performance.now();
 const result=await client.batch({queries,cacheMode,concurrency:8,topK:20,selectedCount:16,timeoutMs:8000});
 samples.push({mode:cacheMode,wallMs:performance.now()-began,componentMs:result.elapsedMs,retrievalMs:result.retrievalMs,status:result.status,
  returnedCount:result.returnedCount,uniqueCount:result.uniqueCount,selectedCount:result.selected.length,cacheHits:result.cacheHits,
  peakScheduledOperations:result.peakConcurrency,peakHttpRequests:result.peakHttpRequests,httpRequests:result.httpRequests,cachePhaseMs:result.cachePhaseMs,operations:result.operations.map(op=>({source:op.source,query:op.query,status:op.status,
   cache:op.cache,returnedCount:op.returnedCount,elapsedMs:op.elapsedMs,error:op.error})),artifact:result.artifact});
}
await mkdir('.reports',{recursive:true});
const file=path.resolve('.reports/technical-research-20261022.json');
await writeFile(file,JSON.stringify({observedAt:new Date().toISOString(),scope:'API metadata retrieval, not full-page reading or model answer latency',samples},null,2)+'\n');
console.log(JSON.stringify({evidence:file,samples},null,2));
if(samples.some(sample=>sample.status!=='ok')||samples.at(-1).cacheHits!==queries.length)process.exitCode=1;
