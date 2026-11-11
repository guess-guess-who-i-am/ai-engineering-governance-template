import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TechnicalResearch} from './technical-research.mjs';
import {ComplementarySearch} from './complementary-search.mjs';
import {createCredentialProvider} from './research-credentials.mjs';
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
async function directory(t){const d=await mkdtemp(path.join(os.tmpdir(),'official-research-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
const args=queries=>({queries,cacheMode:'refresh',timeoutMs:1000});

test('official queries never invoke web scraping, even for empty APIs or Chinese',async t=>{
  const calls=[];
  const search=new ComplementarySearch({cacheDirectory:await directory(t),technical:{batch:async({queries})=>{
    calls.push(...queries);return {operations:queries.map(op=>({...op,status:'empty',results:[]}))};
  }},web:{batch:async()=>{throw new Error('SCRAPING MUST NOT BE CALLED');}}});
  const r=await search.batch(args([{source:'github',query:'中文问题',apiQuery:'empty repo'},{source:'papers',query:'empty paper'}]));
  assert.equal(r.status,'empty');assert.equal(calls.length,2);
  assert.ok(r.operations.every(op=>!op.branches.web));
});

test('credentials use headers only and reflected secrets never reach artifacts',async t=>{
  const directoryName=await directory(t),secret='test-official-secret-value';
  const service=new TechnicalResearch({cacheDirectory:directoryName,credentialProvider:async()=>({token:secret,kind:'test'}),fetchImpl:async(url,options)=>{
    assert.ok(!String(url).includes(secret));assert.equal(options.headers.Authorization,'Bearer '+secret);
    return json({message:'reflected '+secret},401);
  }});
  const r=await service.batch(args([{source:'github',query:'repo'}]));
  assert.equal(r.status,'error');assert.ok(!JSON.stringify(r).includes(secret));
  assert.ok(!(await readFile(r.operations[0].artifact,'utf8')).includes(secret));
});

test('successful results expose authentication and actual search quota',async t=>{
  const service=new TechnicalResearch({cacheDirectory:await directory(t),credentialProvider:async()=>({token:'fake',kind:'github-cli'}),fetchImpl:async()=>
    json({items:[]},200,{'x-ratelimit-limit':'30','x-ratelimit-remaining':'29','x-ratelimit-reset':String(Math.floor(Date.now()/1000)+60)})});
  const r=await service.batch(args([{source:'github',query:'repo'}]));
  assert.equal(r.operations[0].authentication,'github-cli');assert.equal(r.operations[0].quota.limit,30);
  assert.equal(r.operations[0].quota.remaining,29);
});

test('OpenAlex reset is a duration and exhausted budget blocks next request',async t=>{
  let calls=0;const now=Date.now();
  const service=new TechnicalResearch({cacheDirectory:await directory(t),credentialProvider:async()=>({}),fetchImpl:async()=>{
    calls++;return json({results:[]},200,{'x-ratelimit-limit':'10','x-ratelimit-remaining':'0','x-ratelimit-reset':'3600'});
  }});
  const first=await service.batch(args([{source:'openalex',query:'a'}]));
  const second=await service.batch(args([{source:'openalex',query:'b'}]));
  assert.equal(calls,1);assert.equal(second.status,'error');
  assert.ok(Date.parse(first.operations[0].quota.resetAt)>=now+3599000);
  assert.equal(second.operations[0].code,'PROVIDER_COOLDOWN');
});

test('Stack Exchange quota exhaustion is not an empty successful discovery',async t=>{
  let calls=0;const service=new TechnicalResearch({cacheDirectory:await directory(t),credentialProvider:async()=>({}),fetchImpl:async()=>{
    calls++;return json({items:[],quota_max:300,quota_remaining:0});
  }});
  const first=await service.batch(args([{source:'stackoverflow',query:'a'}]));
  const second=await service.batch(args([{source:'stackoverflow',query:'b'}]));
  assert.equal(first.operations[0].quota.remaining,0);assert.equal(calls,1);assert.equal(second.status,'error');
});

test('GitHub starts are paced across independent batches; other providers proceed',async t=>{
  const starts=[];const service=new TechnicalResearch({cacheDirectory:await directory(t),githubIntervalMs:65,credentialProvider:async()=>({token:'fake',kind:'test'}),fetchImpl:async url=>{
    starts.push({source:new URL(url).hostname,time:performance.now()});
    return json(String(url).includes('crossref')?{message:{items:[]}}:{items:[]});
  }});
  await Promise.all(['a','b','c'].map(query=>service.batch(args([{source:'github',query}]))).concat(service.batch(args([{source:'crossref',query:'paper'}]))));
  const github=starts.filter(s=>s.source==='api.github.com');
  assert.equal(github.length,3);assert.ok(github[1].time-github[0].time>=60);
  assert.ok(github[2].time-github[1].time>=60);
  assert.ok(starts.find(s=>s.source==='api.crossref.org').time<github[1].time);
});

test('official general web is explicitly unsupported instead of silently scraped',async t=>{
  const search=new ComplementarySearch({cacheDirectory:await directory(t),fetchImpl:async()=>{throw new Error('Unexpected network');}});
  await assert.rejects(search.batch(args([{source:'web',query:'anything'}])),/official|supported/i);
});

test('configured secrets load without subprocesses and coalesced keychain lookups stay private',async()=>{
  let calls=0;
  const envProvider=createCredentialProvider({env:{OPENALEX_API_KEY:'fake-env'},run:async()=>{throw new Error('Unexpected subprocess');}});
  assert.deepEqual(await envProvider('openalex'),{token:'fake-env',kind:'environment'});
  const keychain=createCredentialProvider({env:{},platform:'darwin',run:async(command,args)=>{
    calls++;assert.equal(command,'/usr/bin/security');assert.ok(args.includes('com.codex.research.openalex'));
    return 'fake-keychain';
  }});
  const results=await Promise.all(Array.from({length:100},()=>keychain('openalex')));
  assert.equal(calls,1);assert.ok(results.every(r=>r.kind==='keychain'));
});

test('quota failure preserves a successful independent official source',async t=>{
  const service=new TechnicalResearch({cacheDirectory:await directory(t),credentialProvider:async()=>({}),fetchImpl:async url=>String(url).includes('openalex')?
    json({error:'quota exhausted'},429,{'retry-after':'60'}):json({message:{items:[{title:['The Tail at Scale'],URL:'https://doi.org/10.1145/2408776.2408794'}]}})});
  const r=await service.batch(args([{source:'openalex',query:'paper'},{source:'crossref',query:'paper'}]));
  assert.equal(r.status,'partial');assert.equal(r.successfulOperations,1);assert.equal(r.failedOperations,1);
  assert.equal(r.selected[0].source,'crossref');assert.ok(r.operations[0].retryAt);
});

test('cached-only requests neither load credentials nor dispatch HTTP',async t=>{
  const service=new TechnicalResearch({cacheDirectory:await directory(t),credentialProvider:async()=>{throw new Error('Unexpected auth lookup');},fetchImpl:async()=>{throw new Error('Unexpected HTTP');}});
  const r=await service.batch({...args([{source:'github',query:'never requested'}]),cacheMode:'only'});
  assert.equal(r.status,'cache-miss');
});

test('Crossref research terms search paper titles rather than broad citation text',async t=>{
  const service=new TechnicalResearch({cacheDirectory:await directory(t),credentialProvider:async()=>({}),fetchImpl:async url=>{
    const parsed=new URL(url);assert.equal(parsed.searchParams.get('query.title'),'The Tail at Scale');
    assert.equal(parsed.searchParams.has('query.bibliographic'),false);
    return json({message:{items:[]}});
  }});
  const r=await service.batch(args([{source:'crossref',query:'The Tail at Scale'}]));
  assert.equal(r.status,'empty',JSON.stringify(r.operations));
});

test('non-JSON throttling also establishes shared cooldown',async t=>{
  let calls=0;const service=new TechnicalResearch({cacheDirectory:await directory(t),credentialProvider:async()=>({}),fetchImpl:async()=>{
    calls++;return new Response('<html>throttled</html>',{status:429});
  }});
  await service.batch(args([{source:'openalex',query:'a'}]));
  const r=await service.batch(args([{source:'openalex',query:'b'}]));
  assert.equal(calls,1);assert.equal(r.operations[0].code,'PROVIDER_COOLDOWN');
});
