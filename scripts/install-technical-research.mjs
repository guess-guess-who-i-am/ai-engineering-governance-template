import {readFile,writeFile,mkdir,rename,cp,access,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scripts=['technical-research.mjs','complementary-search.mjs','technical-research-mcp.mjs'];
export function upgradeSearchRouting(source,reference){
 let next=source;
 if(!next.includes('mcpCatalog')){
   const start='const [registry, ruleDocument] = await Promise.all([';
   const read='readFile(path.join(codexRoot, "skill-registry", "routing-rules.json"), "utf8").then(JSON.parse)';
   const skills='? registry.skills.filter((skill) => skill.source !== "external-library") : [];';
   for(const anchor of [start,read,skills])if(!next.includes(anchor))throw new Error('Search routing upgrade needs explicit migration: unsupported router; no router overwritten');
   next=next.replace(start,'const [registry, ruleDocument, mcpCatalog] = await Promise.all([')
     .replace(read,read+',\n    readFile(path.join(codexRoot, "skill-registry", "mcp-tools.json"), "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return {tools: []}; throw error; })')
     .replace(skills,skills+'\n  skills.push(...(mcpCatalog.tools || []).filter(tool => tool.server === "technical_research" && tool.name === "complementary_search_batch").map(tool => ({name:tool.name,description:tool.description||"",kind:"mcp",mcpServer:tool.server,source:"indexed-mcp",rank:30,keywords:[]})));');
 }
 const referenceStart=reference.indexOf('function capabilityAction('),referenceEnd=reference.indexOf('\nfunction workerSocketPath(',referenceStart);
 if(referenceStart<0||referenceEnd<0)throw new Error('Search routing reference is incomplete');
 const action=reference.slice(referenceStart,referenceEnd);
 const oldStart=next.indexOf('function capabilityAction(');
 const boundary=oldStart<0?-1:next.slice(oldStart+1).search(/\n(?:async )?function /);
 const oldEnd=boundary<0?-1:oldStart+1+boundary;
 if(oldStart>=0){if(oldEnd<0)throw new Error('Search routing upgrade needs explicit migration: capability boundary not found');next=next.slice(0,oldStart)+action+next.slice(oldEnd);}
 else{
   if(!next.includes('function workerSocketPath('))throw new Error('Search routing upgrade needs explicit migration: transport boundary not found');
   next=next.replace('function workerSocketPath(',action+'\nfunction workerSocketPath(');
 }
 if(!next.includes('const action = capabilityAction(selected);')){
   const anchor='  lines.push("If none is genuinely relevant, ignore this list and continue without a specialized Skill.");';
   if(!next.includes(anchor))throw new Error('Search routing upgrade needs explicit migration: output boundary not found');
   next=next.replace(anchor,'  const action = capabilityAction(selected);\n  if (action) lines.push(action);\n'+anchor);
 }
 return next;
}
function run(command,args,cwd,extraEnv={},timeout=180000){return new Promise((resolve,reject)=>{
 const child=spawn(command,args,{cwd,windowsHide:true,shell:process.platform==='win32'&&/\.(cmd|bat)$/i.test(command),stdio:['ignore','pipe','pipe'],env:{...process.env,...extraEnv,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||'')}});
 let errors='';child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>{errors+=chunk;});
 const timer=setTimeout(()=>{child.kill();reject(new Error('Search installation step timed out'));},timeout);
 child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Dependency installation failed: '+errors.slice(-1000)));});
});}
async function ensureDependencies(runtime){
 try{const require=createRequire(path.join(runtime,'package.json'));const entry=require.resolve('@modelcontextprotocol/sdk/server/index.js');await access(entry);return;}catch{}
 // Reuse an already-installed tree. pnpm links are relative within node_modules.
 try{const require=createRequire(path.join(repository,'package.json'));await access(require.resolve('@modelcontextprotocol/sdk/server/index.js'));
   await cp(path.join(repository,'node_modules'),path.join(runtime,'node_modules'),{recursive:true,dereference:false,verbatimSymlinks:true});
   const resolved=createRequire(path.join(runtime,'package.json')).resolve('@modelcontextprotocol/sdk/server/index.js');
   if(!resolved.startsWith(await realpath(runtime)+path.sep))throw new Error('Dependency tree still points outside installed runtime');return;
 }catch{}
 const bundled=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','bin','fallback','pnpm');
 const candidates=process.env.CODEX_SEARCH_PACKAGE_MANAGER?[process.env.CODEX_SEARCH_PACKAGE_MANAGER]:[process.platform==='win32'?'npm.cmd':'npm',bundled];
 let installed=false;
 for(const manager of candidates){
   try{await run(manager,path.basename(manager).includes('pnpm')?['install','--prod','--ignore-scripts','--lockfile=false']:['ci','--omit=dev','--ignore-scripts'],runtime);installed=true;break;}
   catch(error){if(error.code!=='ENOENT')throw error;}
 }
 if(!installed)throw new Error('Node package manager not found. Install Node.js with npm, or set CODEX_SEARCH_PACKAGE_MANAGER to pnpm. MCP config was not changed.');
 createRequire(path.join(runtime,'package.json')).resolve('@modelcontextprotocol/sdk/server/index.js');
}
export async function installResearch({home=os.homedir(),codexHome=process.env.CODEX_HOME||path.join(home,'.codex'),check=false}={}){
 const root=path.resolve(codexHome),runtime=path.join(root,'tools','complementary-search'),entry=path.join(runtime,'scripts','technical-research-mcp.mjs');
 const configFile=path.join(root,'config.toml');let original='';try{original=await readFile(configFile,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 const header='[mcp_servers.technical_research]';
 const block=header+'\ncommand = '+JSON.stringify(process.execPath)+'\nargs = ['+JSON.stringify(entry)+']\nstartup_timeout_sec = 10\ntool_timeout_sec = 40\nenabled = true\n';
 const pattern=/^\[mcp_servers\.technical_research\][\s\S]*?(?=^\[|$(?![\s\S]))/m,match=pattern.exec(original);
 if(/^\[mcp_servers\.technical_research\./m.test(original))throw new Error('Existing technical_research nested configuration needs explicit migration; no configuration changed');
 const next=match?original.slice(0,match.index)+block+(match.index+match[0].length<original.length?'\n':'')+original.slice(match.index+match[0].length):original.trimEnd()+'\n\n'+block;
 const writes=new Map();
 const routerFile=path.join(root,'hooks','skill-router.mjs');
 try{
   const source=await readFile(routerFile,'utf8');
   const reference=await readFile(path.join(repository,'codex-profile/.codex/hooks/skill-router.mjs'),'utf8');
   writes.set(routerFile,Buffer.from(upgradeSearchRouting(source,reference)));
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const rulesFile=path.join(root,'skill-registry','routing-rules.json');let rules={},rulesText='';
 try{rulesText=await readFile(rulesFile,'utf8');rules=JSON.parse(rulesText);}catch(error){if(error.code!=='ENOENT')throw error;}
 const ownedRules=JSON.parse(await readFile(path.join(repository,'codex-profile/.codex/skill-registry/routing-rules.json'),'utf8'));
 let rulesChanged=false;
 for(const name of ['technical_research_batch','complementary_search_batch','parallel-web-research']){
   if(JSON.stringify(rules[name])!==JSON.stringify(ownedRules[name]))rulesChanged=true;
   rules[name]=ownedRules[name];
 }
 writes.set(rulesFile,Buffer.from(rulesChanged?JSON.stringify(rules,null,2)+'\n':rulesText));
 for(const file of scripts)writes.set(path.join(runtime,'scripts',file),await readFile(path.join(repository,'scripts',file)));
 for(const file of ['package.json','package-lock.json'])writes.set(path.join(runtime,file),await readFile(path.join(repository,file)));
 for(const relative of ['SKILL.md','agents/openai.yaml']){
   const bytes=await readFile(path.join(repository,'codex-profile/global-skills/parallel-web-research',relative));
   writes.set(path.join(home,'.agents/skills/parallel-web-research',relative),bytes);
   try{await access(path.join(root,'skills/parallel-web-research/SKILL.md'));writes.set(path.join(root,'skills/parallel-web-research',relative),bytes);}catch{}
 }
 let changed=0;
 for(const [file,bytes]of writes){let actual;try{actual=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(actual?.equals(bytes))continue;changed++;if(check)continue;
   await mkdir(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,bytes,{mode:0o600});await rename(temporary,file);
 }
 if(check){if(changed||next!==original)throw new Error(`Search installation differs: ${changed} files; MCP config current=${next===original}`);
   createRequire(path.join(runtime,'package.json')).resolve('@modelcontextprotocol/sdk/server/index.js');
   return {status:'current',changedFiles:0,entry,global:true};}
 await ensureDependencies(runtime);
 if(next!==original){
   let current='';try{current=await readFile(configFile,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
   if(current!==original)throw new Error('Codex configuration changed during installation; no MCP config was overwritten. Rerun installation.');
   await mkdir(root,{recursive:true,mode:0o700});const temporary=configFile+'.'+randomUUID()+'.tmp';await writeFile(temporary,next,{mode:0o600});await rename(temporary,configFile);changed++;
 }
 return {status:changed?'installed':'current',changedFiles:changed,entry,global:true,needsIndexRefresh:changed>0,otherConfigurationUnchanged:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);let home=os.homedir();
 for(let i=0;i<args.length;i++){if(args[i]==='--home'){if(!args[i+1])throw new Error('--home needs a path');home=path.resolve(args[++i]);}else if(!['--check','--json','--refresh-index'].includes(args[i]))throw new Error('Unknown argument: '+args[i]);}
 const root=process.env.CODEX_HOME||path.join(home,'.codex');
 installResearch({home,codexHome:root,check:args.includes('--check')}).then(async result=>{
   if(args.includes('--refresh-index')&&!args.includes('--check')){
     const refresh=path.join(root,'hooks','refresh-skill-registry.mjs');await access(refresh);
     await run(process.execPath,[refresh],root,{HOME:home,USERPROFILE:home,CODEX_HOME:root,CODEX_SKILL_REGISTRY_FOREGROUND:'1',CODEX_SKIP_EXTERNAL_INDEX_REFRESH:'0'},1200000);
     result.needsIndexRefresh=false;result.indexRefreshed=true;
   }
   console.log(JSON.stringify(result));
 }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
