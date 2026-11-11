import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TechnicalResearch} from './technical-research.mjs';
import {OriginLimiter} from './research-concurrency.mjs';
const json=(x,status=200,headers={})=>new Response(JSON.stringify(x),{status,headers});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function directory(t){const d=await mkdtemp(path.join(os.tmpdir(),'research-stability-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
test('100 simultaneous batches share each identical API request',async t=>{
  let calls=0,active=0,peak=0;
  const technical=new TechnicalResearch({credentialProvider:async()=>({}),githubIntervalMs:0,cacheDirectory:await directory(t),fetchImpl:async()=>{
    calls++;active++;peak=Math.max(peak,active);await wait(30);active--;return json({items:[{full_name:'test/repo',html_url:'https://github.com/test/repo'}]});
  }});
  const r=await Promise.all(Array.from({length:100},()=>technical.batch({queries:[{source:'github',query:'same'}],cacheMode:'refresh',timeoutMs:1000})));
  assert.equal(calls,1);assert.equal(peak,1);assert.ok(r.every(x=>x.successfulOperations===1));
});

test('independent batches obey one shared origin limit',async t=>{
  let active=0,peak=0;
  const technical=new TechnicalResearch({credentialProvider:async()=>({}),githubIntervalMs:0,cacheDirectory:await directory(t),fetchImpl:async()=>{
    active++;peak=Math.max(peak,active);await wait(8);active--;return json({items:[]});
  }});
  const r=await Promise.all(Array.from({length:24},(_,i)=>technical.batch({queries:[{source:'stackoverflow',query:'distinct-'+i}],cacheMode:'refresh',timeoutMs:1000})));
  assert.equal(peak,2);assert.ok(r.every(x=>x.status==='empty'));
});

test('rate-limit cooldown prevents queued calls hitting the origin again',async t=>{
  let calls=0;
  const technical=new TechnicalResearch({credentialProvider:async()=>({}),githubIntervalMs:0,cacheDirectory:await directory(t),fetchImpl:async()=>{
    calls++;await wait(10);return json({message:'rate limited'},429,{'retry-after':'1'});
  }});
  const r=await Promise.all(['a','b','c'].map(query=>technical.batch({queries:[{source:'github',query}],cacheMode:'refresh',timeoutMs:500})));
  assert.equal(calls,1);assert.ok(r.every(x=>x.status==='error'));assert.match(r[1].operations[0].error,/backoff/);
});

test('short coalesced waiter keeps its own deadline',async t=>{
  const technical=new TechnicalResearch({credentialProvider:async()=>({}),githubIntervalMs:0,cacheDirectory:await directory(t),fetchImpl:async()=>{await wait(180);return json({items:[]});}});
  const first=technical.batch({queries:[{source:'github',query:'same'}],cacheMode:'refresh',timeoutMs:500});
  await wait(5);const began=performance.now();
  const short=await technical.batch({queries:[{source:'github',query:'same'}],cacheMode:'refresh',timeoutMs:100});
  assert.equal(short.status,'error');assert.ok(performance.now()-began<160);assert.equal((await first).status,'empty');
});

test('queue expiration removes work, preserving capacity and origin fairness',async()=>{
  const limiter=new OriginLimiter({maximum:2,perOrigin:()=>1,maximumQueued:3});let blockedCalls=0;
  const long=limiter.run('a',performance.now()+500,()=>wait(80));
  const queued=limiter.run('a',performance.now()+15,()=>{blockedCalls++;});
  const sibling=limiter.run('b',performance.now()+200,async()=>42);
  assert.equal(await sibling,42);await assert.rejects(queued,/deadline/);await long;
  assert.equal(blockedCalls,0);assert.equal(limiter.queue.length,0);assert.equal(limiter.peak,2);
});

test('official installer needs no scraping dependency, registers globally, is idempotent and detects drift',async t=>{
  const {installResearch,managedFiles}=await import('./install-research-services-mac.mjs');
  const {mkdir,writeFile,readFile}=await import('node:fs/promises');
  const home=await directory(t),sdk=path.join(home,'runtime/node_modules/@modelcontextprotocol/sdk');
  await mkdir(sdk,{recursive:true});
  await writeFile(path.join(sdk,'package.json'),JSON.stringify({version:'1.32.1'}));
  await mkdir(path.join(home,'.codex'),{recursive:true});
  await writeFile(path.join(home,'.codex/config.toml'),'sentinel = "keep"\n[mcp_servers.other]\ncommand = "keep-other"\n[mcp_servers.technical_research]\ncommand = "old"\n');
  const result=await installResearch({home,sdkDirectory:sdk,noStart:true});assert.equal(result.mode,'official-api-only');
  await installResearch({home,sdkDirectory:sdk,noStart:true});
  await installResearch({home,sdkDirectory:sdk,noStart:true,check:true});
  const text=await readFile(path.join(home,'.codex/config.toml'),'utf8');
  assert.match(text,/keep-other/);assert.match(text,/sentinel = "keep"/);assert.equal((text.match(/\[mcp_servers.technical_research\]/g)||[]).length,1);
  const plist=await readFile(path.join(home,'Library/LaunchAgents/com.codex.research.plist'),'utf8');
  assert.match(plist,/<key>KeepAlive<\/key><true\/>/);assert.match(plist,/<key>RunAtLoad<\/key><true\/>/);
  assert.equal(Object.keys(result.hashes).length,managedFiles.length);
  await writeFile(path.join(home,'.codex/config.toml'),text.replace('technical-research-mcp.mjs','stale-entry.mjs'));
  await assert.rejects(installResearch({home,sdkDirectory:sdk,noStart:true,check:true}),/registration drift/);
  await writeFile(path.join(home,'.codex/config.toml'),text);
  await writeFile(path.join(result.destination,'scripts/research-service.mjs'),'drift');
  await assert.rejects(installResearch({home,sdkDirectory:sdk,noStart:true,check:true}),/drift/);
});
