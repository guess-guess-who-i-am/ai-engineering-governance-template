import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TechnicalResearch, PROVIDERS } from './technical-research.mjs';
let active=0,peak=0,calls=0,githubActive=0,githubPeak=0;
const server=createServer(async(req,res)=>{
  calls++;active++;peak=Math.max(peak,active);const u=new URL(req.url,'http://local');
  const source=u.pathname.slice(1),q=u.searchParams.get('q')||u.searchParams.get('search')||u.searchParams.get('query.bibliographic');
  if(source==='github'){githubActive++;githubPeak=Math.max(githubPeak,githubActive);}
  const done=()=>{active--;if(source==='github')githubActive--;};
  const timer=setTimeout(()=>{done();res.setHeader('Content-Type','application/json');
    if(q==='fail'){res.writeHead(503);res.end('{"message":"deliberate failure"}');return;}
    if(q==='http429'){res.writeHead(429,{'retry-after':'60','content-type':'text/plain'});res.end('rate limited');return;}
    if(q==='backoff'){res.end('{"backoff":10,"items":[]}');return;}
    const x=source==='github'?{items:[{full_name:'owner/project',html_url:'https://github.com/owner/project',stargazers_count:5000}]}:
      source==='stackoverflow'?{items:[{title:'Question',link:'https://stackoverflow.com/questions/1',body:'<p>Body</p>',score:5}],has_more:true}:
      source==='openalex'?{results:[{display_name:'Paper',doi:'https://doi.org/10.test/a',publication_year:2024}],meta:{count:100}}:
      {message:{items:[{title:['Paper'],URL:'https://doi.org/10.test/a'}],'total-results':100}};
    res.end(JSON.stringify(x));},q.startsWith('slow')?500:60);
  res.on('close',()=>{if(!res.writableEnded){clearTimeout(timer);done();}});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const base='http://127.0.0.1:'+server.address().port;
 const cacheDirectory=await mkdtemp(path.join(os.tmpdir(),'technical-research-'));
 const client=new TechnicalResearch({cacheDirectory,providerEndpoints:Object.fromEntries(PROVIDERS.map(p=>[p,base+'/'+p]))});
 const queries=PROVIDERS.map(source=>({source,query:'example'}));
 const first=await client.batch({queries:[...queries,queries[0]],cacheMode:'refresh'});
 assert.equal(first.duplicateOperations,1);assert.equal(calls,4);assert(peak>=2);assert(first.peakConcurrency>=2);
 assert.equal(first.uniqueCount,3,'DOI duplicates across scholarly APIs must merge');
 const before=calls;
 const second=await client.batch({queries,cacheMode:'prefer'});
 assert.equal(second.cacheHits,4);assert.equal(calls,before,'cache hit must not issue HTTP');
 assert.equal(second.httpRequests,0);assert.equal(second.peakHttpRequests,0,'cached work must not be reported as HTTP concurrency');
 assert(second.operations.every(op=>op.network===null));
 assert(first.httpRequests===4&&first.peakHttpRequests>=2,'actual HTTP intervals must show overlap, not only scheduler width');
 assert.equal(JSON.parse(await readFile(first.artifact,'utf8')).returnedCount,4);
 assert.equal(JSON.parse(await readFile(first.operations[0].artifact,'utf8')).rawText.includes('Question'),true,'full provider body must be retained');
 const partial=await client.batch({queries:[{source:'github',query:'fail'},{source:'openalex',query:'ok'}],cacheMode:'refresh'});
 assert.equal(partial.status,'partial');assert.equal(partial.successfulOperations,1);assert.equal(partial.failedOperations,1);
 assert.equal(JSON.parse(await readFile(partial.operations[0].artifact,'utf8')).rawText,'{"message":"deliberate failure"}');
 const missing=await client.batch({queries:[{source:'github',query:'not cached'}],cacheMode:'only'});
 assert.equal(missing.status,'cache-miss');assert.equal(calls,before+2);
 await client.batch({queries:[{source:'github',query:'a'},{source:'github',query:'b'}],cacheMode:'refresh'});
 assert.equal(githubPeak,1,'GitHub search must stay serial within a batch');
 const timed=await client.batch({queries:[{source:'crossref',query:'slow'}],cacheMode:'refresh',timeoutMs:100});
 assert.equal(timed.failedOperations,1);assert.match(timed.operations[0].error,/timeout|abort/i);
 await client.batch({queries:[{source:'stackoverflow',query:'backoff'}],cacheMode:'refresh'});
 const countBeforeBackoff=calls;
 const blocked=await client.batch({queries:[{source:'stackoverflow',query:'another'}],cacheMode:'refresh'});
 assert.equal(blocked.failedOperations,1);assert.equal(calls,countBeforeBackoff);
 await assert.rejects(client.batch({queries:[{source:'arbitrary',query:'x'}]}),/supported/);
 await assert.rejects(client.batch({queries,concurrency:21}),/concurrency/);
 const beforeDeadline=calls;
 const bounded=await client.batch({queries:[1,2,3].map(i=>({source:'github',query:'slow-'+i})),cacheMode:'refresh',timeoutMs:100,concurrency:1});
 assert.equal(calls-beforeDeadline,1,'a batch deadline must stop queued HTTP work, not give every item a fresh deadline');
 assert.equal(bounded.failedOperations,3);
 const many=await client.batch({queries:Array.from({length:20},(_,i)=>({source:'openalex',query:'independent-'+i})),cacheMode:'refresh',concurrency:8,timeoutMs:3000});
 assert.equal(many.uniqueOperations,20);assert.equal(many.successfulOperations,20);assert.equal(many.returnedCount,20);
 const limited=await client.batch({queries:[{source:'crossref',query:'http429'}],cacheMode:'refresh'});
 assert.equal(limited.failedOperations,1);const before429=calls;
 const after429=await client.batch({queries:[{source:'crossref',query:'after429'}],cacheMode:'refresh'});
 assert.equal(after429.failedOperations,1);assert.equal(calls,before429,'Retry-After applies even when the error body is not JSON');
 const isolated=new TechnicalResearch({cacheDirectory,providerEndpoints:Object.fromEntries(PROVIDERS.map(p=>[p,base+'/'+p]))});
 const slowOrigin=isolated.batch({queries:[{source:'github',query:'slow-unrelated'}],cacheMode:'refresh',timeoutMs:1500});
 await new Promise(resolve=>setTimeout(resolve,20));
 const hot=await isolated.batch({queries:[{source:'github',query:'example'}],cacheMode:'prefer',timeoutMs:100});
 const hotOnly=await isolated.batch({queries:[{source:'github',query:'example'}],cacheMode:'only',timeoutMs:100});
 await slowOrigin;
 assert.equal(hot.cacheHits,1,'a valid cached response must bypass an unrelated live GitHub queue');
 assert.equal(hot.failedOperations,0,'an origin queue must not make a cached request expire');
 assert.equal(hotOnly.cacheHits,1,'cache-only lookup must also bypass origin queues');
 assert.equal(hot.httpRequests,0);assert.equal(hotOnly.httpRequests,0);
 const beforeCoalescing=calls;
 const sameQuery={queries:[{source:'openalex',query:'coalesced-operation'}],cacheMode:'refresh'};
 const coalesced=await Promise.all([isolated.batch(sameQuery),isolated.batch(sameQuery)]);
 assert.equal(calls-beforeCoalescing,1,'concurrent identical discovery calls share one HTTP request');
 assert.equal(coalesced[0].operations[0].network.requestId,coalesced[1].operations[0].network.requestId);
 console.log(JSON.stringify({regression:'cached lookup during unrelated 500ms origin request',cachedMs:hot.elapsedMs,cacheOnlyMs:hotOnly.elapsedMs,originQueueBypassed:true}));
 console.log('PASS: real HTTP overlap, cache/no-network, dedupe, raw artifacts, partial errors, timeout and rate backoff.');
}finally{const closing=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closing;}
