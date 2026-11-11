import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TechnicalResearch} from './technical-research.mjs';
import {FreeWebSearch, ComplementarySearch} from './complementary-search.mjs';

const json = (value, status=200) => new Response(JSON.stringify(value), {status});
async function directory(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'research-search-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}
const webArgs={topK:3,cacheMode:'refresh',maxAgeSeconds:300,concurrency:2,timeoutMs:1000};
const envelope=(results=[],partialFailures=[])=>({status:'ok',data:{results,partialFailures}});
const card={title:'Attention Is All You Need',url:'https://arxiv.org/abs/1706.03762',description:'Original paper',engine:'duckduckgo'};
const daemonStatus={status:'ok',data:{capabilities:['search'],configSummary:{allowedSearchEngines:['duckduckgo','bing']}}};
const daemonFetch=impl=>(url,options)=>String(url).endsWith('/status')?Promise.resolve(json(daemonStatus)):impl(url,options);

test('global web uses daemon /search without a workspace IDE',async t=>{
  const requests=[];
  const web=new FreeWebSearch({cacheDirectory:await directory(t),fetchImpl:daemonFetch(async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});return json(envelope([card]));
  })});
  const result=await web.batch({...webArgs,queries:['Attention Is All You Need']});
  assert.equal(requests[0].url,'http://127.0.0.1:3210/search');
  assert.deepEqual(requests[0].body.engines,['duckduckgo','bing']);
  assert.equal(requests[0].body.limit,6);
  assert.equal(result.operations[0].results[0].url,card.url);
});

test('empty, partial engine failure and envelope failure are distinct',async t=>{
  const web=new FreeWebSearch({cacheDirectory:await directory(t),fetchImpl:daemonFetch(async(_url,options)=>{
    const {query}=JSON.parse(options.body);
    if(query==='broken')return json({status:'error',error:{code:'engine_error',message:'captcha'},hint:'Inspect engine'});
    return json(envelope(query==='partial'?[card]:[],query==='partial'?[{engine:'bing',message:'redirect limit'}]:[]));
  })});
  const {operations}=await web.batch({...webArgs,queries:['empty','partial','broken']});
  assert.equal(operations[0].status,'empty');
  assert.equal(operations[1].results.length,1);assert.equal(operations[1].failures[0].engine,'bing');
  assert.equal(operations[2].status,'error');assert.match(operations[2].error,/captcha/);
});

test('malformed daemon results are errors rather than false empty success',async t=>{
  const web=new FreeWebSearch({cacheDirectory:await directory(t),fetchImpl:daemonFetch(async()=>json({status:'ok',data:{}}))});
  assert.equal((await web.batch({...webArgs,queries:['bad']})).operations[0].status,'error');
});

test('web preserves successful siblings and bounds overlapping requests',async t=>{
  let active=0,peak=0;
  const web=new FreeWebSearch({cacheDirectory:await directory(t),fetchImpl:daemonFetch(async(_url,options)=>{
    active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,20));active--;
    const {query}=JSON.parse(options.body);
    if(query==='failed')throw new Error('ECONNRESET');
    return json(envelope([{...card,url:card.url+'?q='+query}]));
  })});
  const r=await web.batch({...webArgs,queries:['one','failed','three','four']});
  assert.equal(peak,2);assert.equal(r.operations.filter(o=>o.results.length).length,3);
  assert.equal(r.operations[1].status,'error');
});

test('web cache only never networks and clean successes are reusable',async t=>{
  let calls=0;
  const web=new FreeWebSearch({cacheDirectory:await directory(t),fetchImpl:daemonFetch(async()=>{calls++;return json(envelope([card]));})});
  const miss=await web.batch({...webArgs,queries:['paper'],cacheMode:'only'});
  assert.equal(calls,0);assert.equal(miss.operations[0].status,'cache-miss');
  await web.batch({...webArgs,queries:['paper']});
  const hit=await web.batch({...webArgs,queries:['paper'],cacheMode:'only'});
  assert.equal(calls,1);assert.equal(hit.operations[0].cache,'hit');
});

test('shared web deadline aborts active request and skips queued consumers',async t=>{
  let calls=0;
  const web=new FreeWebSearch({cacheDirectory:await directory(t),fetchImpl:daemonFetch(async(_url,{signal})=>{
    calls++;await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('test request exceeded deadline')),1000);
      signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});
    });
  })});
  const r=await web.batch({...webArgs,queries:['one','two','three'],concurrency:1,timeoutMs:40});
  assert.equal(calls,1);assert.ok(r.operations.every(o=>o.status==='error'));assert.ok(r.elapsedMs<500);
  assert.equal(r.operations[1].network,undefined);
});

test('GitHub searches README by default, preserves explicit in qualifier and original input',async t=>{
  const requests=[];
  const technical=new TechnicalResearch({cacheDirectory:await directory(t),fetchImpl:async url=>{
    requests.push(new URL(url).searchParams.get('q'));return json({items:[],total_count:0});
  }});
  const r=await technical.batch({queries:[{source:'github',query:'MCP cache'},{source:'github',query:'MCP in:name stars:>100'}],cacheMode:'refresh'});
  assert.deepEqual(requests,['MCP cache in:name,description,readme','MCP in:name stars:>100']);
  assert.equal(r.operations[0].query,'MCP cache');assert.equal(r.operations[0].requestQuery,requests[0]);
});

test('HTTP success without hits is empty, not successful discovery',async t=>{
  const technical=new TechnicalResearch({cacheDirectory:await directory(t),fetchImpl:async()=>json({items:[],total_count:0})});
  const r=await technical.batch({queries:[{source:'github',query:'nonexistent'}],cacheMode:'refresh'});
  assert.equal(r.status,'empty');assert.equal(r.successfulOperations,0);assert.equal(r.emptyOperations,1);
  assert.equal(r.completedOperations,1);assert.equal(r.operations[0].httpStatus,200);
  assert.match(r.operations[0].diagnostic,/query|querying/i);
});

test('equivalent request scopes preserve both original query identities',async t=>{
  const service=new ComplementarySearch({cacheDirectory:await directory(t),fetchImpl:async()=>json({items:[{full_name:'test/repo',html_url:'https://github.com/test/repo'}]})});
  const r=await service.batch({queries:[{source:'github',query:'MCP'},{source:'github',query:'MCP in:name,description,readme'}],cacheMode:'refresh'});
  assert.deepEqual(r.operations.map(o=>o.branches.api.query),['MCP','MCP in:name,description,readme']);
  assert.ok(r.operations.every(o=>o.status==='completed'));
});

test('paper web branch finds a preprint absent from Crossref',async t=>{
  const service=new ComplementarySearch({cacheDirectory:await directory(t),fetchImpl:daemonFetch(async url=>{
    if(String(url).includes('api.crossref.org'))return json({message:{items:[{title:['Is Attention All You Need?'],URL:'https://doi.org/other'}]}});
    assert.equal(new URL(url).pathname,'/search');return json(envelope([card]));
  })});
  const r=await service.batch({queries:[{source:'papers',query:card.title,expectedUrl:card.url}],cacheMode:'refresh'});
  assert.equal(r.operations[0].targetMissing,false);assert.equal(r.operations[0].status,'completed');
  assert.ok(r.selected.some(c=>c.url===card.url));assert.equal(r.fullDocumentsFetched,0);
  assert.equal(r.selected[0].url,card.url);
});

test('short apiQuery preserves original question and diagnoses genuine zero hits',async t=>{
  const service=new ComplementarySearch({cacheDirectory:await directory(t),fetchImpl:daemonFetch(async url=>{
    if(String(url).includes('api.stackexchange.com')){
      assert.equal(new URL(url).searchParams.get('q'),'MCP tools/list_changed');return json({items:[]});
    }
    return json(envelope());
  })});
  const r=await service.batch({queries:[{source:'stackoverflow',query:'MCP tools list changed notification refresh cache',apiQuery:'MCP tools/list_changed'}],cacheMode:'refresh'});
  assert.equal(r.status,'empty');assert.equal(r.operations[0].query,'MCP tools list changed notification refresh cache');
  assert.ok(r.operations[0].reasons.includes('api-empty'));
});

test('missing target remains partial even with unrelated candidates',async t=>{
  const service=new ComplementarySearch({cacheDirectory:await directory(t),fetchImpl:daemonFetch(async url=>
    String(url).includes('api.crossref.org')?json({message:{items:[]}}):json(envelope([card])))});
  const r=await service.batch({queries:[{source:'papers',query:'nonexistent',expectedTitle:'No Such Paper'}],cacheMode:'refresh'});
  assert.equal(r.operations[0].targetMissing,true);assert.equal(r.status,'partial');
});

test('refuses daemon substitution of a disallowed free engine',async t=>{
  let calls=0;
  const web=new FreeWebSearch({cacheDirectory:await directory(t),fetchImpl:async()=>{
    calls++;return json({status:'ok',data:{capabilities:['search'],configSummary:{allowedSearchEngines:['exa']}}});
  }});
  const r=await web.batch({...webArgs,queries:['paper']});
  assert.equal(calls,1);assert.match(r.operations[0].error,/refusing/);
});
