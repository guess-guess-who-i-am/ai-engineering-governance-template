#!/usr/bin/env node
import {readFile,writeFile,mkdir,copyFile,rename,access,symlink,rm,lstat,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const source=path.dirname(fileURLToPath(import.meta.url));
export const managedFiles=['research-concurrency.mjs','technical-research.mjs','complementary-search.mjs','research-tools.mjs','technical-research-mcp.mjs','research-service.mjs','research-credentials.mjs'];
const xml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function launchAgent(label,command,args,home){return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${[command,...args].map(s=>'<string>'+xml(s)+'</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>2</integer><key>ExitTimeOut</key><integer>35</integer><key>WorkingDirectory</key><string>${xml(home)}</string><key>StandardOutPath</key><string>${xml(path.join(home,'.codex/logs',label+'.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(home,'.codex/logs',label+'.err.log'))}</string></dict></plist>\n`;}
function run(command,args,{cwd=source,timeout=120000}={}){return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||'')},stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error(path.basename(command)+' timed out'));},timeout);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolve({code,stdout:out,stderr:err});});
});}
async function atomic(file,data){await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.install-'+process.pid;await writeFile(tmp,data,{mode:0o600});await rename(tmp,file);}
async function exists(file){try{await access(file);return true;}catch{return false;}}
export async function installResearch({home=os.homedir(),sdkDirectory,check=false,noStart=false}={}){
  home=path.resolve(home);
  // --home can stage another user's files; HOME can also be overridden by a
  // test. Only the account database identifies the actual launchd owner.
  if(home!==path.resolve(os.userInfo().homedir))noStart=true;
  const codex=path.join(home,'.codex'),destination=path.join(codex,'tools/complementary-search');
  const candidates=[sdkDirectory,path.join(home,'.codex/tools/llm-task-tree/llm-task-tree-kit/node_modules/@modelcontextprotocol/sdk'),path.resolve(source,'../node_modules/@modelcontextprotocol/sdk')].filter(Boolean);
  const expected=JSON.parse(await readFile(path.join(source,'../package.json'),'utf8')).dependencies['@modelcontextprotocol/sdk'];
  let sdk;
  for(const candidate of candidates){
    if(!await exists(path.join(candidate,'package.json')))continue;
    const version=JSON.parse(await readFile(path.join(candidate,'package.json'),'utf8')).version;
    if(version!==expected)throw new Error('Runtime SDK version mismatch: '+version+'; expected '+expected);
    sdk=path.resolve(candidate);break;
  }
  if(!sdk)throw new Error('Pinned MCP SDK not found; install the repository dependencies or task-tree runtime.');
  const backup=path.join(codex,'backups','search-services-'+Date.now());
  if(!check){
    await mkdir(backup,{recursive:true,mode:0o700});
    for(const name of managedFiles){const file=path.join(destination,'scripts',name);if(await exists(file))await copyFile(file,path.join(backup,name));}
  }
  for(const name of managedFiles){
    const data=await readFile(path.join(source,name)),file=path.join(destination,'scripts',name);
    if(check){if(!data.equals(await readFile(file)))throw new Error('Installed search file drift: '+name);}
    else await atomic(file,data);
  }
  const configFile=path.join(codex,'config.toml');
  const old=await readFile(configFile,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  const block='[mcp_servers.technical_research]\ncommand = '+JSON.stringify(process.execPath)+'\nargs = ['+JSON.stringify(path.join(destination,'scripts/technical-research-mcp.mjs'))+']\nstartup_timeout_sec = 10\ntool_timeout_sec = 40\nenabled = true\n';
  const pattern=/^\[mcp_servers\.technical_research(?:\.[^\]]+)?\][\s\S]*?(?=^\[|$(?![\s\S]))/gm;
  if(check){
    const blocks=[...old.matchAll(pattern)].map(match=>match[0].trim());
    if(blocks.length!==1||blocks[0]!==block.trim())throw new Error('Search MCP registration drift');
    if(await realpath(path.join(destination,'node_modules/@modelcontextprotocol/sdk'))!==await realpath(sdk))throw new Error('Search MCP SDK link drift');
  }else{
    const target=path.join(destination,'node_modules/@modelcontextprotocol/sdk');
    if(await exists(target)){
      if(await realpath(target)!==await realpath(sdk)){
        if(!(await lstat(target)).isSymbolicLink())throw new Error('Managed SDK path is not a symlink; refusing replacement');
        await rm(target);await symlink(sdk,target,'dir');
      }
    }else{await mkdir(path.dirname(target),{recursive:true});await symlink(sdk,target,'dir');}
    const updated=old.replace(pattern,'').trimEnd()+'\n\n'+block;
    if(old!==updated)await atomic(configFile,updated);

  }
  await mkdir(path.join(codex,'logs'),{recursive:true,mode:0o700});
  // Retire only our dedicated scraping LaunchAgent. The task-tree runtime's
  // separate web capability is outside this installer's ownership.
  const retired=path.join(home,'Library/LaunchAgents/com.codex.research-web.plist');
  if(await exists(retired)){
    const owned=(await readFile(retired,'utf8')).includes(path.join(destination,'scripts/research-web-service.mjs'));
    if(!owned)throw new Error('Retired search LaunchAgent has unrecognized ownership');
    if(check)throw new Error('Obsolete scraping LaunchAgent remains installed');
    await copyFile(retired,path.join(backup,'com.codex.research-web.plist'));
    if(!noStart&&process.platform==='darwin'){
      const label='gui/'+process.getuid()+'/com.codex.research-web';
      const loaded=await run('/bin/launchctl',['print',label]);
      if(!loaded.code){const r=await run('/bin/launchctl',['bootout',label]);if(r.code)throw new Error('Cannot retire scraping service: '+r.stderr);}
    }
    await rm(retired);
  }
  for(const name of ['research-web-service.mjs','patch-research-web.mjs']){
    const obsolete=path.join(destination,'scripts',name);
    if(!await exists(obsolete))continue;
    if(check)throw new Error('Obsolete scraping script remains installed: '+name);
    await copyFile(obsolete,path.join(backup,name));await rm(obsolete);
  }
  const agents=[['com.codex.research','research-service.mjs',[]]];
  for(const [label,entry,extra]of agents){
    const file=path.join(home,'Library/LaunchAgents',label+'.plist'),data=launchAgent(label,process.execPath,[path.join(destination,'scripts',entry),...extra],home);
    const unchanged=await readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})===data;
    if(check){if(await readFile(file,'utf8')!==data)throw new Error('Search LaunchAgent drift: '+label);}else await atomic(file,data);
    if(!noStart){
      if(process.platform!=='darwin'||home!==os.homedir())throw new Error('Service activation requires the current macOS user; use --no-start for a fixture');
      const domain='gui/'+process.getuid();
      if(check){const r=await run('/bin/launchctl',['print',domain+'/'+label]);if(r.code)throw new Error('Search LaunchAgent not loaded: '+label);}
      else{
        const loaded=await run('/bin/launchctl',['print',domain+'/'+label]);
        if(unchanged&&loaded.code===0){
          const r=await run('/bin/launchctl',['kickstart','-k',domain+'/'+label]);
          if(r.code)throw new Error('Search LaunchAgent restart failed: '+r.stderr);
          continue;
        }
        if(loaded.code===0){
          const previousPid=Number(loaded.stdout.match(/^\s*pid = (\d+)/m)?.[1]);
          const removed=await run('/bin/launchctl',['bootout',domain+'/'+label]);
          if(removed.code)throw new Error('Search LaunchAgent removal failed: '+removed.stderr);
          // bootout returns before process teardown. Re-registering immediately
          // can fail with bootstrap EIO (5); wait for the owned process to exit.
          const deadline=Date.now()+36000;
          while(previousPid){
            try{process.kill(previousPid,0);}catch(error){if(error.code==='ESRCH')break;throw error;}
            if(Date.now()>=deadline)throw new Error('Previous search LaunchAgent did not exit: '+label);
            await new Promise(resolve=>setTimeout(resolve,100));
          }
        }
        const r=await run('/bin/launchctl',['bootstrap',domain,file]);if(r.code)throw new Error('Search LaunchAgent bootstrap failed: '+r.stderr);
      }
    }
  }
  if(!noStart){
    const revisionHash=createHash('sha256');
    for(const name of ['research-service.mjs','research-tools.mjs','technical-research.mjs','complementary-search.mjs','research-concurrency.mjs','research-credentials.mjs'])revisionHash.update(await readFile(path.join(destination,'scripts',name)));
    const expectedRevision=revisionHash.digest('hex');
    for(const port of [3211]){
      let ready=false;
      for(let attempt=0;attempt<100;attempt++){
        try{const response=await fetch('http://127.0.0.1:'+port+'/status',{signal:AbortSignal.timeout(500)}),body=await response.json();
          if(response.ok&&body.status==='ok'&&body.revision===expectedRevision){ready=true;break;}
        }catch{}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!ready)throw new Error('Managed search service did not become ready on port '+port);
    }
  }
  const receipt={status:check?'current':'installed',destination,mode:'official-api-only',sdk,services:agents.map(a=>a[0]),backup:check?undefined:backup,
    hashes:Object.fromEntries(await Promise.all(managedFiles.map(async name=>[name,createHash('sha256').update(await readFile(path.join(destination,'scripts',name))).digest('hex')])))};
  return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options={};for(let i=2;i<process.argv.length;i++){const a=process.argv[i];if(a==='--home')options.home=process.argv[++i];else if(a==='--sdk-directory')options.sdkDirectory=process.argv[++i];else if(a==='--check')options.check=true;else if(a==='--no-start')options.noStart=true;else if(a!=='--json')throw new Error('Unknown argument: '+a);}
  installResearch(options).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('Research installation failed: '+e.message);process.exitCode=1;});
}
