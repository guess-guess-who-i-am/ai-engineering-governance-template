#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const args=process.argv.slice(2), check=args.includes('--check');
for(let i=0;i<args.length;i++)if(!['--home','--check','--json'].includes(args[i])&&args[i-1]!=='--home')throw new Error('Unknown argument: '+args[i]);
const position=args.indexOf('--home');
if(position>=0&&!args[position+1])throw new Error('--home requires a path');
const home=path.resolve(position>=0?args[position+1]:os.homedir());
const codex=path.join(home,'.codex'), label='com.codex.global-graph';
const plist=path.join(home,'Library/LaunchAgents',label+'.plist');
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const wanted=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(codex,'hooks/graph-worker-supervisor.mjs'))}</string><string>--processes</string><string>4</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>3</integer><key>EnvironmentVariables</key><dict><key>CODEX_HOME</key><string>${xml(codex)}</string><key>HOME</key><string>${xml(home)}</string></dict></dict></plist>\n`;
let before;try{before=await readFile(plist,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
// HOME is overridden by clean-home tests; only the OS account directory may
// own a live launchd service for this UID.
const realHome=home===path.resolve(os.userInfo().homedir);
const run=(...parameters)=>{const result=spawnSync('launchctl',parameters,{encoding:'utf8'});if(result.error)throw result.error;return result;};
if(realHome&&process.platform!=='darwin')throw new Error('Global graph login service requires macOS');
const domain=`gui/${process.getuid()}`, active=realHome&&run('print',domain+'/'+label).status===0;
if(check){
 if(before!==wanted)throw new Error('Global graph service configuration differs: '+plist);
 if(realHome&&!active)throw new Error('Global graph login service is not registered');
}else if(before!==wanted||realHome&&!active){
 await mkdir(path.dirname(plist),{recursive:true});
 const temporary=plist+'.install-'+process.pid;
 try{
  if(active){const stopped=run('bootout',domain,plist);if(stopped.status)throw new Error(stopped.stderr);}
  await writeFile(temporary,wanted,{mode:0o600});await rename(temporary,plist);
  if(realHome){const started=run('bootstrap',domain,plist);if(started.status)throw new Error(started.stderr);}
 }catch(error){
  if(before===undefined)await unlink(plist).catch(()=>{});else await writeFile(plist,before,{mode:0o600});
  if(active)run('bootstrap',domain,plist);
  throw error;
 }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
console.log(JSON.stringify({status:check?'current':before===wanted&&(!realHome||active)?'already-current':'installed',plist,processes:4,registered:realHome,runAtLoad:true,keepAlive:true}));
