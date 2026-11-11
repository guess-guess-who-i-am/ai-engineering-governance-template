import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TechnicalResearch} from './technical-research.mjs';
import {ComplementarySearch} from './complementary-search.mjs';

const json = (value, status=200) => new Response(JSON.stringify(value), {status});
async function directory(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'research-search-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}
function officialSearch(options){return new ComplementarySearch({...options,technical:new TechnicalResearch({...options,credentialProvider:async()=>({}),githubIntervalMs:0})});}
test('GitHub searches README by default, preserves explicit in qualifier and original input',async t=>{
  const requests=[];
  const technical=new TechnicalResearch({credentialProvider:async()=>({}),githubIntervalMs:0,cacheDirectory:await directory(t),fetchImpl:async url=>{
    requests.push(new URL(url).searchParams.get('q'));return json({items:[],total_count:0});
  }});
  const r=await technical.batch({queries:[{source:'github',query:'MCP cache'},{source:'github',query:'MCP in:name stars:>100'}],cacheMode:'refresh'});
  assert.deepEqual(requests,['MCP cache in:name,description,readme','MCP in:name stars:>100']);
  assert.equal(r.operations[0].query,'MCP cache');assert.equal(r.operations[0].requestQuery,requests[0]);
});

test('HTTP success without hits is empty, not successful discovery',async t=>{
  const technical=new TechnicalResearch({credentialProvider:async()=>({}),githubIntervalMs:0,cacheDirectory:await directory(t),fetchImpl:async()=>json({items:[],total_count:0})});
  const r=await technical.batch({queries:[{source:'github',query:'nonexistent'}],cacheMode:'refresh'});
  assert.equal(r.status,'empty');assert.equal(r.successfulOperations,0);assert.equal(r.emptyOperations,1);
  assert.equal(r.completedOperations,1);assert.equal(r.operations[0].httpStatus,200);
  assert.match(r.operations[0].diagnostic,/query|querying/i);
});

test('equivalent request scopes preserve both original query identities',async t=>{
  const service=officialSearch({cacheDirectory:await directory(t),fetchImpl:async()=>json({items:[{full_name:'test/repo',html_url:'https://github.com/test/repo'}]})});
  const r=await service.batch({queries:[{source:'github',query:'MCP'},{source:'github',query:'MCP in:name,description,readme'}],cacheMode:'refresh'});
  assert.deepEqual(r.operations.map(o=>o.branches.api.query),['MCP','MCP in:name,description,readme']);
  assert.ok(r.operations.every(o=>o.status==='completed'));
});

test('papers exposes missing preprint instead of scraping an apparent match',async t=>{
  const service=officialSearch({cacheDirectory:await directory(t),fetchImpl:async url=>{
    assert.equal(new URL(url).hostname,'api.crossref.org');return json({message:{items:[{title:['Different paper'],URL:'https://doi.org/other'}]}});
  }});
  const r=await service.batch({queries:[{source:'papers',query:'Attention Is All You Need',expectedUrl:'https://arxiv.org/abs/1706.03762'}],cacheMode:'refresh'});
  assert.equal(r.operations[0].targetMissing,true);assert.equal(r.status,'partial');assert.equal(r.fullDocumentsFetched,0);
});

test('short apiQuery preserves original question and diagnoses genuine zero hits',async t=>{
  const service=officialSearch({cacheDirectory:await directory(t),fetchImpl:async url=>{
    if(String(url).includes('api.stackexchange.com')){
      assert.equal(new URL(url).searchParams.get('q'),'MCP tools/list_changed');return json({items:[]});
    }
    throw new Error("Unexpected nonofficial request");
  }});
  const r=await service.batch({queries:[{source:'stackoverflow',query:'MCP tools list changed notification refresh cache',apiQuery:'MCP tools/list_changed'}],cacheMode:'refresh'});
  assert.equal(r.status,'empty');assert.equal(r.operations[0].query,'MCP tools list changed notification refresh cache');
  assert.ok(r.operations[0].reasons.includes('official-api-only'));
});

test('missing target remains partial even with unrelated official candidates',async t=>{
  const service=officialSearch({cacheDirectory:await directory(t),fetchImpl:async()=>json({message:{items:[{title:['Other'],URL:'https://doi.org/other'}]}})});
  const r=await service.batch({queries:[{source:'papers',query:'nonexistent',expectedTitle:'No Such Paper'}],cacheMode:'refresh'});
  assert.equal(r.operations[0].targetMissing,true);assert.equal(r.status,'partial');
});
