import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const home=await mkdtemp(path.join(os.tmpdir(),'shared graph service & '));
const script=path.resolve('scripts/install-global-graph-service-mac.mjs');
const run=(...args)=>spawnSync(process.execPath,[script,'--home',home,...args],{encoding:'utf8',env:{...process.env,HOME:home}});
try{
 assert.notEqual(run('--check').status,0);
 const first=run();assert.equal(first.status,0,first.stderr);const result=JSON.parse(first.stdout);
 assert.equal(result.processes,4);assert.equal(result.registered,false);
 const text=await readFile(result.plist,'utf8');assert.ok(text.includes('&amp;'));assert.ok(text.includes('<key>RunAtLoad</key><true/>'));assert.ok(text.includes('<key>KeepAlive</key><true/>'));
 const second=run();assert.equal(second.status,0,second.stderr);assert.equal(JSON.parse(second.stdout).status,'already-current');
 const checked=run('--check');assert.equal(checked.status,0,checked.stderr);
 assert.notEqual(run('--nonsense').status,0);
 console.log('Global graph service install, idempotence, check, XML escaping and invalid argument checks passed.');
}finally{await rm(home,{recursive:true,force:true});}
