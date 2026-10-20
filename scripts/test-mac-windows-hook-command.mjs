import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {adaptInstaller} from './install-mac-profile-on-windows.mjs';

const source=await readFile(new URL('./install-codex-profile-mac.mjs',import.meta.url),'utf8');
const native=adaptInstaller(source,'test-hash');
const section=(start,end)=>native.slice(native.indexOf(start),native.indexOf(end,native.indexOf(start)));
const functions=section('function shellQuote(', 'function mergeManagedBlock(')+section('function hooksDocument(', 'async function buildOperations(');
const documentFor=root=>vm.runInNewContext(functions+'\nhooksDocument(root)',{process,path,root});
assert(documentFor('test').hooks.SessionStart[0].hooks[0].command.startsWith('& '),'Windows Hook needs PowerShell call operator before a quoted executable');

if(process.platform==='win32'){
 const temporary=await mkdtemp(path.join(os.tmpdir(),'codex-hook-command-'));
 try{
  for(const name of ['simple',"目录 space ' $quote ` &"]){
   const root=path.join(temporary,name);
   await mkdir(path.join(root,'hooks'),{recursive:true});
   await writeFile(path.join(root,'hooks/hook-dispatch.mjs'),'let raw=""; for await (const chunk of process.stdin) raw+=chunk; process.stdout.write(JSON.stringify({seen:JSON.parse(raw).hook_event_name}));\n');
   const document=documentFor(root);
   for(const event of ['SessionStart','UserPromptSubmit']){
    const command=document.hooks[event][0].hooks[0].command;
    for(const shell of [path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),'pwsh.exe']){
     const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{input:JSON.stringify({hook_event_name:event}),encoding:'utf8',windowsHide:true,timeout:10000});
     assert.equal(result.status,0,`${shell}: ${result.stderr||result.error?.message}`);
     assert.equal(JSON.parse(result.stdout).seen,event);
    }
   }
  }
 }finally{await rm(temporary,{recursive:true,force:true});}
}
console.log('PASS: Windows Hook commands execute through PowerShell, including Unicode and shell metacharacters.');
