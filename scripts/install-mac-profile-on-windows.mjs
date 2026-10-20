/** Deploy the pinned macOS profile, changing operating-system bindings only. */
import {readFile,writeFile,readdir,mkdir,cp,copyFile,rename,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';

const here=path.dirname(fileURLToPath(import.meta.url));
export const PIN='0cd7d48d90c24a0cf8d0515b8b0dd871fcaac7b2';
const normalized=value=>value.replace(/\r\n/g,'\n');
const digest=value=>createHash('sha256').update(value).digest('hex');
function replaceOne(source,old,value){if(source.split(old).length!==2)throw new Error('Pinned source anchor changed: '+old.slice(0,90));return source.replace(old,value);}
const nativePythonPath=source=>source.replaceAll('"graph-tool-call-venv", "bin", "python"','"graph-tool-call-windows", "Scripts", "python.exe"');
const hiddenChildren=source=>source.replaceAll('spawn(command, args, {','spawn(command, args, { windowsHide: true,').replaceAll('spawn(server.command, server.args, {','spawn(server.command, server.args, { windowsHide: true,');

export function adaptWorker(raw){
 let source=normalized(raw).replace('import fcntl\n','import portalocker as fcntl\nimport hmac\nimport secrets\n');
 source=source.replaceAll('fcntl.flock(', 'fcntl.lock(').replaceAll('except BlockingIOError:', 'except fcntl.exceptions.LockException:');
 source=source.replace('socketserver.UnixStreamServer','socketserver.TCPServer');
 source=replaceOne(source,'            results = self.server.worker.query(payload)',
  '            if not hmac.compare_digest(str(payload.pop("_token", "")), self.server.token):\n                raise PermissionError("Worker authentication failed")\n            results = self.server.worker.query(payload)');
 source=replaceOne(source,'        super().__init__(socket_path, _WorkerHandler)',
  '        self.token = secrets.token_hex(32)\n        super().__init__(("127.0.0.1", 0), _WorkerHandler)');
 source=replaceOne(source,'    os.chmod(socket_path, 0o600)',
  '    # The Windows installer protects the containing directory with a user-only ACL.\n    endpoint = {"host":"127.0.0.1", "port":server.server_address[1], "token":server.token, "pid":os.getpid()}\n    temporary = socket_path.with_name(socket_path.name + f".{os.getpid()}.tmp")\n    temporary.write_text(json.dumps(endpoint), encoding="utf-8")\n    os.replace(temporary, socket_path)');
 source=source.replace('subprocess.run([args.node, args.script], check=True,','subprocess.run([args.node, args.script], check=True, creationflags=subprocess.CREATE_NO_WINDOW,');
 return source;
}
export function adaptRouter(raw){
 let source=nativePythonPath(normalized(raw));
 const start=source.indexOf('function workerSocketPath('),end=source.indexOf('async function requestAfterWorkerStart(',start);
 if(start<0||end<0)throw new Error('Pinned transport boundary not found');
 source=source.slice(0,start)+source.slice(end);
 source=replaceOne(source,'#!/usr/bin/env node\n','#!/usr/bin/env node\nimport {workerSocketPath, requestGraphWorker, startGraphWorker} from "./mac-windows-transport.mjs";\n');
 source=replaceOne(source,'  if (!directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 0o077)) {','  if (!directory.isDirectory()) {');
 return source;
}
export function adaptRefresh(raw){
 let source=hiddenChildren(nativePythonPath(normalized(raw)));
 const nativeEnv='{ ...process.env, PYTHONUTF8: "1", SENTENCE_TRANSFORMERS_HOME: path.join(codexRoot,"tools","embedding-models"), HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", OMP_NUM_THREADS: "4", MKL_NUM_THREADS: "4", OPENBLAS_NUM_THREADS: "4" }';
 source=source.replaceAll('env: process.env',`env: ${nativeEnv}`);
 source=source.replace('spawn(graphPython, args, { windowsHide: true,','spawn(graphPython, args, { env: '+nativeEnv+', windowsHide: true,');
 source=source.replace('detached: true, stdio:', 'detached: true, windowsHide: true, stdio:');
 source=source.replace('    if (!current) continue;','    if (!current) continue;\n    if (/^\\s*enabled\\s*=\\s*false\\s*$/.test(line)) current.disabled = true;');
 source=source.replace('servers.filter((server) => server.command)','servers.filter((server) => server.command && !server.disabled)');
 source=source.replace('try { mcpCatalogData = await listMcpTools(codexRoot, mcpCatalog); } catch { mcpCatalogData = { tools: [] }; }','try { mcpCatalogData = await listMcpTools(codexRoot, mcpCatalog); } catch (error) { process.stderr.write(`MCP discovery failed: ${error.message}\\n`); mcpCatalogData = { tools: [] }; }');
 // Decode Windows TOML literal/basic strings correctly; not a routing change.
 source=source.replace('if (command) current.command = command[1];','if (command) current.command = line.includes("= \\\"") ? JSON.parse(line.slice(line.indexOf("=")+1).trim()) : command[1];');
 source=source.replace('if (args) current.args = [...args[1].matchAll(/["\']([^"\']*)["\']/g)].map((m) => m[1]);',
  'if (args) current.args = args[1].trim().startsWith("\\\"") ? JSON.parse("["+args[1]+"]") : [...args[1].matchAll(/["\']([^"\']*)["\']/g)].map((m) => m[1]);');
 return source;
}
export function adaptDispatcher(raw){
 return normalized(raw).replace(/\(process\.platform === "win32" \? "[^"\n]+" : ""\)/g,'""');
}
export function adaptInstaller(raw,previousAgentsHash){
 let source=hiddenChildren(nativePythonPath(normalized(raw)));
 source=replaceOne(source,'  return `\'${String(value).replaceAll("\'", `\'"\'"\'`)}\'`;','  return `"${String(value)}"`;');
 source=replaceOne(source,'  const currentAgents = await exists(agentsDestination) ? await readFile(agentsDestination, "utf8") : "";',
  `  let currentAgents = await exists(agentsDestination) ? await readFile(agentsDestination, "utf8") : "";\n  if (sha256(currentAgents) === ${JSON.stringify(previousAgentsHash)}) currentAgents = "";`);
 // Logical C: paths can resolve to a D: junction. Absolute route targets retain
 // the same owners without relying on a physical-path-relative home.
 source=source.replace('route.skillFile = `../../.agents/skills/${route.id}/SKILL.md`;','route.skillFile = path.join(agentsHome,"skills",route.id,"SKILL.md");');
 source=source.replace('env, stdio:', 'env, windowsHide: true, stdio:');
 source=source.replaceAll('sentence-transformers==6.1.0\\n','sentence-transformers==6.1.0\\nportalocker==3.2.0\\n');
 source=replaceOne(source,'process.env.CODEX_PYTHON || (await exists("/opt/homebrew/bin/python3") ? "/opt/homebrew/bin/python3" : "python3")','process.env.CODEX_PYTHON || path.join(os.homedir(),"AppData","Local","Programs","Python","Python311","python.exe")');
 return source;
}
function run(command,args,{env=process.env,input='',cwd,timeout=1200000}={}){return new Promise((resolve,reject)=>{
 const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 const timer=setTimeout(()=>{child.kill();reject(new Error('Process deadline exceeded: '+path.basename(command)));},timeout);
 child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',error=>{clearTimeout(timer);reject(error);});
 child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error(path.basename(command)+' failed: '+stderr.slice(-5000)));else resolve({stdout,stderr});});child.stdin.end(input);
});}
async function exists(file){return stat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});}
async function secure(directory){
 await mkdir(directory,{recursive:true});const who=await run('whoami',['/user','/fo','csv','/nh']);const sid=who.stdout.match(/S-1-5-[0-9-]+/)?.[0];
 if(!sid)throw new Error('Windows SID unavailable');await run('icacls',[directory,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F']);
}
async function write(file,content){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);}
async function main(){
 if(process.platform!=='win32')throw new Error('Use the native macOS deployer on macOS');
 const args=process.argv.slice(2),flag=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
 for(let index=0;index<args.length;index++){
  if(args[index]==='--check')continue;
  if(!['--source','--home','--library'].includes(args[index]))throw new Error('Unknown argument: '+args[index]);
  if(!args[index+1]||args[index+1].startsWith('--'))throw new Error(args[index]+' requires a value');
  index++;
 }
 const source=path.resolve(flag('--source')||path.join(here,'../.reports/upstream-macos-0cd7d48'));
 const home=path.resolve(flag('--home')||os.homedir()),root=path.join(home,'.codex');
 const check=args.includes('--check');
 const rawSource=path.join(root,'tools/macos-profile-source');const nativeSource=path.join(root,'tools/macos-profile-native');
 const previous=await readFile(path.join(root,'skill-registry/mac-source.json'),'utf8').then(JSON.parse).catch(()=>({}));
 const library=path.resolve(flag('--library')||process.env.CODEX_EXTERNAL_SKILL_ROOT||previous.library||path.join(root,'tools/skills'));
 const python=path.join(root,'tools/graph-tool-call-windows/Scripts/python.exe');
 const modelCache=path.join(root,'tools/embedding-models');
 const env={...process.env,CODEX_HOME:root,HOME:home,USERPROFILE:home,CODEX_EXTERNAL_SKILL_ROOT:library,CODEX_EXTERNAL_SKILL_CATALOG:path.join(library,'_catalog_cn.json'),CODEX_PROFILE_SKILL_SOURCE:library,CODEX_GRAPH_TOOL_PYTHON:python,SENTENCE_TRANSFORMERS_HOME:modelCache,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHONUTF8:'1',OMP_NUM_THREADS:'4',MKL_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4'};
 if(!check){
  const git=await run('git',['-C',source,'rev-parse','HEAD']);if(git.stdout.trim()!==PIN)throw new Error('Unexpected upstream commit');
  const status=await run('git',['-C',source,'status','--porcelain']);if(status.stdout.trim())throw new Error('Upstream worktree is modified');
  const id=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
  const backup=path.join(root,'backups/mac-direct',id);await mkdir(backup,{recursive:true});
  for(const name of ['hooks','prompts','prompt-publisher','skill-registry'])if(await exists(path.join(root,name)))await cp(path.join(root,name),path.join(backup,name),{recursive:true});
  for(const name of ['config.toml','AGENTS.md','hooks.json'])if(await exists(path.join(root,name)))await copyFile(path.join(root,name),path.join(backup,name));
  if(await exists(path.join(home,'.agents/skills')))await cp(path.join(home,'.agents/skills'),path.join(backup,'agents-skills'),{recursive:true});
  await secure(backup);await secure(path.join(root,'skill-registry/mac-private'));
  const originalAgents=await readFile(path.join(root,'AGENTS.md'),'utf8').catch(()=> '');
  const previousAgentsHash=digest(originalAgents);
  for(const destination of [rawSource,nativeSource]){
    await mkdir(destination,{recursive:true});
    await cp(path.join(source,'codex-profile'),path.join(destination,'codex-profile'),{recursive:true,filter:entry=>!entry.includes('__pycache__')&&!/\.py[co]$/.test(entry)});
    await mkdir(path.join(destination,'scripts'),{recursive:true});
    for(const name of ['install-codex-profile-mac.mjs','install-task-tree-mcp-mac.mjs','parallel-run.mjs','ensure-global-skill-library.mjs','test-hook-cadence-mac.mjs','test-parallel-run.mjs'])await copyFile(path.join(source,'scripts',name),path.join(destination,'scripts',name));
  }
  const edits=[
    ['codex-profile/mac/hooks/graph_skill_index.py',adaptWorker],
    ['codex-profile/.codex/hooks/skill-router.mjs',adaptRouter],
    ['codex-profile/mac/hooks/refresh-skill-registry.mjs',adaptRefresh],
    ['codex-profile/.codex/hooks/hook-dispatch.mjs',adaptDispatcher],
    ['scripts/install-codex-profile-mac.mjs',text=>adaptInstaller(text,previousAgentsHash)],
    ['scripts/install-task-tree-mcp-mac.mjs',hiddenChildren]
  ];
  const adaptations=[];
  for(const [relative,transform]of edits){const original=await readFile(path.join(rawSource,relative),'utf8');const adapted=transform(original);await write(path.join(nativeSource,relative),adapted);adaptations.push({file:relative,upstreamSha256:digest(original),nativeSha256:digest(adapted)});}
  await copyFile(path.join(here,'mac-windows-transport.mjs'),path.join(nativeSource,'codex-profile/mac/hooks/mac-windows-transport.mjs'));
  await write(path.join(root,'skill-registry/mac-source.json'),JSON.stringify({commit:PIN,branch:'codex/macos-global-deploy',source:rawSource,nativeSource,library,python,modelCache,backup,adaptations},null,2)+'\n');
  console.log(JSON.stringify({phase:'backed-up',backup,commit:PIN}));
 }
 const installed=await run(process.execPath,[path.join(nativeSource,'scripts/install-codex-profile-mac.mjs'),'--home',home,'--json',...(check?['--check']:[])],{env});
 console.log(installed.stdout.trim());
 if(check)return;
 await copyFile(path.join(rawSource,'scripts/parallel-run.mjs'),path.join(root,'tools/parallel-run.mjs'));
 // Retire only the old platform-specific modules that this repository installed.
 const manifest=JSON.parse(await readFile(path.join(root,'skill-registry/mac-source.json'),'utf8'));
 for(const name of ['graph-client.mjs','skill-metadata.mjs'])if(await exists(path.join(root,'hooks',name))){await mkdir(path.join(manifest.backup,'retired-windows'),{recursive:true});await rename(path.join(root,'hooks',name),path.join(manifest.backup,'retired-windows',name));}
 console.log(JSON.stringify({phase:'profile-installed',commit:PIN,automaticUse:'requires Codex Hook trust; no hashes approved by installer'}));
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
