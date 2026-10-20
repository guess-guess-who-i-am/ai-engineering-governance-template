import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
const source=await readFile(new URL('./prewarm-mac-worker.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export async function ensureWarmWorker('),source.indexOf('\nif(process.argv[1]')).replace('export ','');
let launches=0,clock=0;
const context={path,os:{homedir:()=>'/test'},process:{env:{}},Date:{now:()=>clock+=1000},setTimeout:fn=>fn(),
 readFile:async()=>JSON.stringify({python:'/python'}),realpath:async value=>value,stat:async()=>({mtimeNs:7n}),workerSocketPath:()=>'/endpoint',
 startGraphWorker:()=>{launches++;return {exitCode:launches===1?0:null,signalCode:null};},
 requestGraphWorkerRaw:async()=>{if(launches<2)throw Object.assign(new Error('endpoint absent'),{code:'ENOENT'});return {ready:true,pid:99,warmWorkers:[1,2,3,4].map(pid=>({pid,ready:true,loads:1,graphMtimeNs:'7'}))};}
};
const ensure=vm.runInNewContext(body+'\nensureWarmWorker',context);
const result=await ensure('/test');assert.equal(result.ready,true);assert.equal(launches,2,'A contender that exits before publishing readiness must not strand startup');
console.log('PASS: an exited lock contender is retried; launch attempts are not treated as a ready service.');
