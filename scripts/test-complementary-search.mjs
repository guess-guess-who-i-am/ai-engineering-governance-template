import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {ComplementarySearch,FreeWebSearch} from './complementary-search.mjs';

const folder=await mkdtemp(path.join(os.tmpdir(),'complement-search-'));
let apiCalls=[],webCalls=[];
const api={async batch(args){apiCalls.push(args);return {operations:args.queries.map(({source,query})=>({source,query,status:query==='limited'?'error':'ok',results:query==='empty'||query==='limited'?[]:[{source,rank:1,title:query==='wrong'?'different paper':query,url:'https://github.com/owner/'+query}],...(query==='limited'?{error:'HTTP 429',httpStatus:429}:{})}))};}};
const web={async batch(args){webCalls.push(args);return {operations:args.queries.map(query=>({query,status:'ok',results:[{source:'web',rank:1,title:query,url:'https://example.org/'+encodeURIComponent(query)}]}))};}};
const client=new ComplementarySearch({cacheDirectory:folder,technical:api,web});
const result=await client.batch({queries:[{source:'github',query:'good'},{source:'stackoverflow',query:'empty'},{source:'github',query:'limited'},{source:'github',query:'wrong',expectedTitle:'target'},
 {source:'github',query:'中文连接池'},{source:'papers',query:'Exact paper'},{source:'web',query:'MDN Promise.all'},{source:'github',query:'good'}]});
assert.equal(result.uniqueOperations,7);assert.equal(apiCalls.length,1);assert.equal(webCalls.length,2);
assert(!apiCalls[0].queries.some(x=>x.query==='中文连接池'));
assert(webCalls[0].queries.includes('Exact paper'));assert(webCalls[0].queries.includes('中文连接池 site:github.com'));
assert.deepEqual(new Set(webCalls[1].queries),new Set(['empty site:stackoverflow.com','limited site:github.com','wrong site:github.com']));
assert(!webCalls.flatMap(c=>c.queries).includes('good site:github.com'),'successful API must not be repeated on web');
assert(result.operations.find(op=>op.query==='limited').branches.api.httpStatus===429);
assert.equal(result.status,'partial','successful supplement must preserve original failure');
assert.equal(JSON.parse(await readFile(result.artifact,'utf8')).operations.length,7);
await client.batch({queries:[{source:'github',query:'中文',apiQuery:' English query '}]});
assert(apiCalls.at(-1).queries.some(q=>q.query==='English query'),'caller supplied English query can use API');
assert.equal(webCalls.length,2);
await assert.rejects(client.batch({queries:[{source:'web',query:'x'}],timeoutMs:45000}),/timeoutMs/);
await assert.rejects(client.batch({queries:[{source:'bad',query:'x'}]}),/source/);
await assert.rejects(client.batch({queries:[{source:'web',query:'x',unexpected:true}]}),/Unknown query field/);
await assert.rejects(client.batch({queries:[{source:'web',query:'x'}],unexpected:true}),/Unknown argument/);
await assert.rejects(client.batch(null),/object/);

// Verify real local HTTP: provider safety, raw partial results, caching, protocol,
// and cache-only zero HTTP to both config and batch endpoints.
let requests=0,batches=0,mode='free';
const server=createServer(async(req,res)=>{
 requests++;res.setHeader('content-type','application/json');
 if(req.url==='/api/web-search/config'){res.end(JSON.stringify({config:{provider:mode==='free'?'openwebsearch':'tavily',enabled:true,requiresApiKey:mode!=='free'}}));return;}
 batches++;let text='';for await(const c of req)text+=c;const args=JSON.parse(text);
 res.end(JSON.stringify({queries:args.queries.map(query=>({query,status:'completed',cache:{hit:false},warnings:[],failures:[]})),results:args.queries.map(query=>({url:'https://example.net/'+encodeURIComponent(query),title:query,matches:[{query,rank:1,title:query,content:'public snippet'}]}))}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const live=new FreeWebSearch({cacheDirectory:folder,baseUrl:'http://127.0.0.1:'+server.address().port});
 const args={queries:['one','two','one'],topK:10,cacheMode:'refresh',maxAgeSeconds:300,concurrency:8,timeoutMs:1000};
 const first=await live.batch(args);assert.equal(first.operations.length,2);assert.equal(batches,1);
 const count=requests;const cached=await live.batch({...args,cacheMode:'only'});assert.equal(requests,count);assert(cached.operations.every(op=>op.cache==='hit'));
 const missing=await live.batch({...args,queries:['missing'],cacheMode:'only'});assert.equal(requests,count);assert.equal(missing.operations[0].status,'cache-miss');
 mode='paid';const paid=await live.batch({...args,queries:['new']});assert.equal(batches,1);assert.match(paid.operations[0].error,/keyless/);
 assert.throws(()=>new FreeWebSearch({cacheDirectory:folder,baseUrl:'https://paid.example'}),/loopback/);
}finally{const done=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await done;}

// Independent primary sources overlap, and fallback shares the original budget.
let active=0,peak=0,budgets=[];
const slow={async batch(args){budgets.push(args.timeoutMs);active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,45));active--;return {operations:args.queries.map(q=>({...q,status:'error',error:'upstream unavailable',results:[]}))};}};
const delayedWeb={async batch(args){budgets.push(args.timeoutMs);active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,30));active--;return {operations:args.queries.map(query=>({query,status:'ok',results:[]}))};}};
const overlap=new ComplementarySearch({cacheDirectory:folder,technical:slow,web:delayedWeb});
await overlap.batch({queries:[{source:'github',query:'fail'},{source:'web',query:'parallel'}],timeoutMs:300});
assert.equal(peak,2);assert.equal(budgets[0],150);assert(budgets.at(-1)<280,'fallback must not get a new complete deadline');
console.log('PASS: complementary routing, only deficient directions supplemented, Chinese bypass/English opt-in, paper overlap, provenance, shared deadline, free-only provider enforcement, dedupe and zero-HTTP cache.');
