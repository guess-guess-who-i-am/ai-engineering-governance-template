import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=await mkdtemp(path.join(os.tmpdir(),'graph-owner-test-'));
const graph=path.join(root,'skill-registry/skills.graph.json');
const endpoint=`/tmp/codex-graph-${process.getuid()}/${createHash('sha256').update(graph).digest('hex').slice(0,24)}.sock`;
await mkdir(path.dirname(graph),{recursive:true});
await mkdir(path.join(root,'tools/graph-tool-call-venv/bin'),{recursive:true});
const marker=path.join(root,'spawned');
await writeFile(path.join(root,'tools/graph-tool-call-venv/bin/python'),`#!/bin/sh\nprintf 'spawned\\n' >> '${marker}'\n`,{mode:0o700});
let probes=0;
const server=net.createServer(connection=>connection.on('data',()=>{probes++;connection.end(JSON.stringify({ok:true,pid:process.pid,ready:false})+'\n');}));
await new Promise(resolve=>server.listen(endpoint,resolve));
const child=spawn(process.execPath,['codex-profile/mac/hooks/graph-worker-supervisor.mjs','--query-workers','8'],{env:{...process.env,CODEX_HOME:root},stdio:'pipe'});
let errors='';child.stderr.on('data',chunk=>errors+=chunk);
let exit=null;child.on('exit',code=>exit=code);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const until=Date.now()+6000;
 while(probes<3&&Date.now()<until)await sleep(50);
 assert.ok(probes>=3,errors);
 await assert.rejects(readFile(marker),{code:'ENOENT'});
 await new Promise(resolve=>server.close(resolve));
 const retryUntil=Date.now()+5000;
 while(Date.now()<retryUntil){try{await readFile(marker);break;}catch{await sleep(50);}}
 assert.match(await readFile(marker,'utf8'),/spawned/);
 console.log('Existing cold owner adopted without Python starts; owner loss starts replacement.');
}finally{
 child.kill('SIGTERM');
 const until=Date.now()+5000;
 while(exit===null&&Date.now()<until)await sleep(50);
 if(exit===null)child.kill('SIGKILL');
 server.close();await rm(endpoint,{force:true});await rm(root,{recursive:true,force:true});
}
