/** Keep pinned macOS prompts/scoring; adapt Windows bindings and eagerly warm its pool. */
import {readFile,writeFile,readdir,mkdir,cp,copyFile,rename,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {ensureWarmWorker} from './prewarm-mac-worker.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export const PIN='0cd7d48d90c24a0cf8d0515b8b0dd871fcaac7b2';
export const POLICY_FILES=[
 'package.json','package-lock.json',
 'scripts/install-technical-research.mjs','scripts/technical-research.mjs','scripts/complementary-search.mjs','scripts/technical-research-mcp.mjs',
 'codex-profile/global-skills/parallel-web-research/SKILL.md','codex-profile/global-skills/parallel-web-research/agents/openai.yaml',
 'scripts/parallel-run.mjs',
 'scripts/install-task-tree-mcp-mac.mjs',
 'codex-profile/.codex/hooks/skill-router.mjs',
 'codex-profile/.codex/skill-registry/routing-rules.json',
 'codex-profile/mac/hooks/graph_skill_index.py',
 'codex-profile/mac/hooks/refresh-skill-registry.mjs',
 'codex-profile/mac/hooks/context-refresh.mjs',
 'codex-profile/mac/hooks/validate-methodology-routing.mjs',
 'codex-profile/.codex/prompt-publisher/publish-methodology.mjs',
 'codex-profile/.codex/prompt-publisher/methodology-targets.json',
 'codex-profile/.codex/prompt-publisher/README.zh.md',
 'codex-profile/.codex/prompt-publisher/methodology-translation-cache.en.md',
 'codex-profile/.codex/prompt-publisher/methodology-state.json',
 'codex-profile/global-skills/verify-before-completion/SKILL.md',
 ...['method-research-evidence','method-engineering-execution','method-evaluation-gates','method-github-delivery','method-task-tree'].map(name=>'codex-profile/global-skills/'+name+'/SKILL.md'),
 ...['global-methodology-source.zh.md','global-every-turn.zh.md','global-every-turn.en.md','global-attention-anchor.zh.md','global-attention-anchor.en.md','global-methodology-router.zh.md','global-methodology-router.en.md','global-methodology-routing-review.zh.md','global-methodology-map.json'].map(name=>'codex-profile/.codex/prompts/'+name)
];
export async function stagePolicyUpdates(root,nativeSource){
 const policySource=path.join(root,'tools/macos-profile-policy');const policyFiles=[];
 for(const file of POLICY_FILES){const bytes=await readFile(path.resolve(here,'..',file));for(const destination of [policySource,nativeSource]){await mkdir(path.dirname(path.join(destination,file)),{recursive:true});await writeFile(path.join(destination,file),bytes);}policyFiles.push({file,sha256:digest(bytes)});}
 return {policySource,policyFiles,policyRevision:'routing-repair-v3-20261020'};
}
export const adaptTaskTreeInstaller=source=>hiddenChildren(normalized(source));
export async function registerTaskTreeRuntime(root,{check=false}={}){
 const config=await readFile(path.join(root,'config.toml'),'utf8');
 const block=config.match(/\[mcp_servers\.task_tree\]([\s\S]*?)(?=\n\[|$)/)?.[1]||'';
 const literal=block.match(/args\s*=\s*\['([^']+)'\]/)?.[1];
 const basic=block.match(/args\s*=\s*(\["[^\n]+\])/ )?.[1];
 const entry=literal||(basic?JSON.parse(basic)[0]:'');
 if(!entry)throw new Error('Registered task_tree MCP entry is missing');
 const runtime=path.resolve(path.dirname(entry),'..');
 for(const relative of ['context/turn-tracker.js','context/turn-context.js','platform/execution-scope.js','task-tree/tree-quality.js','task-tree/maintenance.js'])await stat(path.join(runtime,'ide/backend',relative));
 if(check){const actual=JSON.parse(await readFile(path.join(root,'skill-registry/task-tree-runtime.json'),'utf8'));if(path.resolve(actual.root)!==runtime)throw new Error('Task-tree runtime pointer differs from the registered MCP');return runtime;}
 await mkdir(path.join(root,'skill-registry'),{recursive:true});
 await writeFile(path.join(root,'skill-registry/task-tree-runtime.json'),JSON.stringify({root:runtime,source:'registered task_tree MCP entry'},null,2)+'\n');
 return runtime;
}
export async function prepareRoutingIndex(root,manifest){
 const env={...process.env,CODEX_HOME:root,CODEX_GRAPH_TOOL_PYTHON:manifest.python,SENTENCE_TRANSFORMERS_HOME:manifest.modelCache,HF_HUB_OFFLINE:'0',TRANSFORMERS_OFFLINE:'0',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',PYTHONUTF8:'1',OMP_NUM_THREADS:'4',MKL_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4'};
 const cached=await run(manifest.python,[path.join(here,'cache-routing-model.py'),'--codex-home',root],{env});
 console.log(cached.stdout.trim());
 const refresh=await run(process.execPath,[path.join(root,'hooks/refresh-skill-registry.mjs')],{env:{...env,CODEX_SKILL_REGISTRY_FOREGROUND:'1',CODEX_SKIP_EXTERNAL_INDEX_REFRESH:'0',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'},input:'{}',timeout:1200000});
 if(/skipped:|failed:|timed out/i.test(refresh.stderr))throw new Error('Registry rebuild failed: '+refresh.stderr);
 const state=JSON.parse(await readFile(path.join(root,'skill-registry/external-skills-manifest.json'),'utf8'));
 if(state.embedding!=='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')throw new Error('Multilingual graph generation was not installed');
 console.log(JSON.stringify({phase:'graph-current',embedding:state.embedding,reusedVectors:state.reusedVectors,encodedVectors:state.encodedVectors}));
}
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
  '            if not hmac.compare_digest(str(payload.pop("_token", "")), self.server.token):\n                raise PermissionError("Worker authentication failed")\n            if payload.get("_op") in ("status", "stop"):\n                response = {"ok": True, "pid": os.getpid(), "ready": True, "warmWorkers": self.server.worker._warm_reports, "runtimeSha256": RUNTIME_SHA256}\n                if payload["_op"] == "stop":\n                    self.server.stopping.set()\n                self.wfile.write((json.dumps(response) + "\\n").encode("utf-8"))\n                self.wfile.flush()\n                return\n            results = self.server.worker.query(payload)');
 source=replaceOne(source,'        super().__init__(socket_path, _WorkerHandler)',
  '        self.token = secrets.token_hex(32)\n        super().__init__(("127.0.0.1", 0), _WorkerHandler)');
 source=replaceOne(source,'    os.chmod(socket_path, 0o600)',
  '    # The Windows installer protects the containing directory with a user-only ACL.\n    endpoint = {"host":"127.0.0.1", "port":server.server_address[1], "token":server.token, "pid":os.getpid()}\n    temporary = socket_path.with_name(socket_path.name + f".{os.getpid()}.tmp")\n    temporary.write_text(json.dumps(endpoint), encoding="utf-8")\n    os.replace(temporary, socket_path)');
 source=source.replace('subprocess.run([args.node, args.script], check=True,','subprocess.run([args.node, args.script], check=True, creationflags=subprocess.CREATE_NO_WINDOW,');
 source=replaceOne(source,'def _initialize_query_process(graph_path):\n    global _process_worker\n    _process_worker = _GraphWorker(Path(graph_path))',
  'def _initialize_query_process(graph_path, warm_barrier):\n    global _process_worker, _warm_report, _warm_barrier\n    _warm_barrier = warm_barrier\n    _process_worker = _GraphWorker(Path(graph_path))\n    _process_worker.query({"query": "Diagnose a reproducible software bug", "top_k": 8, "deadline": time.time() * 1000 + 180000})\n    _warm_report = {"pid": os.getpid(), "loads": _process_worker.loads, "ready": True, "graphMtimeNs": str(_process_worker._signature[2])}\n    warm_barrier.wait(timeout=180)\n\ndef _ready_query_process():\n    _warm_barrier.wait(timeout=180)\n    return _warm_report');
 source=replaceOne(source,'    def _new_pool(self):\n        return ProcessPoolExecutor(max_workers=self._processes,\n            mp_context=multiprocessing.get_context(\'spawn\'),\n            initializer=_initialize_query_process, initargs=(str(self._path),))',
  '    def _new_pool(self):\n        context = multiprocessing.get_context("spawn")\n        barrier = context.Barrier(self._processes)\n        pool = ProcessPoolExecutor(max_workers=self._processes,\n            mp_context=context, initializer=_initialize_query_process,\n            initargs=(str(self._path), barrier))\n        futures = [pool.submit(_ready_query_process) for _ in range(self._processes)]\n        try:\n            reports = [future.result(timeout=180) for future in futures]\n            self._warm_reports = sorted({report["pid"]: report for report in reports}.values(), key=lambda report: report["pid"])\n            if len(self._warm_reports) != self._processes:\n                raise RuntimeError("Not every retrieval process completed warm-up")\n        except BaseException:\n            pool.shutdown(wait=False, cancel_futures=True)\n            raise\n        return pool');
 source=replaceOne(source,'    stopping = threading.Event()','    stopping = threading.Event()\n    server.stopping = stopping');
 return source;
}
export function adaptRouter(raw){
 let source=nativePythonPath(normalized(raw));
 const start=source.indexOf('function workerSocketPath('),end=source.indexOf('async function requestAfterWorkerStart(',start);
 if(start<0||end<0)throw new Error('Pinned transport boundary not found');
 source=source.slice(0,start)+source.slice(end);
 source=replaceOne(source,'#!/usr/bin/env node\n','#!/usr/bin/env node\nimport {workerSocketPath, requestGraphWorker, startGraphWorker} from "./mac-windows-transport.mjs";\n');
 source=replaceOne(source,'  if (!directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 0o077)) {','  if (!directory.isDirectory()) {');
 source=replaceOne(source,'Math.min(5000, deadline - Date.now())','Math.min(55000, deadline - Date.now())');
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
 source=replaceOne(source,'  return `\'${String(value).replaceAll("\'", `\'"\'"\'`)}\'`;','  return `\'${String(value).replaceAll("\'", "\'\'")}\'`;');
 source=replaceOne(source,'  const command = (name) => `${shellQuote(process.execPath)} ${shellQuote(path.join(codexHome, "hooks", name))}`;',
  '  const command = (name) => `& ${shellQuote(process.execPath)} ${shellQuote(path.join(codexHome, "hooks", name))}`;');
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
  const policy=await stagePolicyUpdates(root,nativeSource);
  const edits=[
    ['codex-profile/mac/hooks/graph_skill_index.py',adaptWorker],
    ['codex-profile/.codex/hooks/skill-router.mjs',adaptRouter],
    ['codex-profile/mac/hooks/refresh-skill-registry.mjs',adaptRefresh],
    ['codex-profile/.codex/hooks/hook-dispatch.mjs',adaptDispatcher],
    ['scripts/install-codex-profile-mac.mjs',text=>adaptInstaller(text,previousAgentsHash)],
    ['scripts/install-task-tree-mcp-mac.mjs',adaptTaskTreeInstaller]
  ];
  const adaptations=[];
  for(const [relative,transform]of edits){const original=await readFile(path.join(rawSource,relative),'utf8');const effective=await readFile(path.join(nativeSource,relative),'utf8');const adapted=transform(effective);await write(path.join(nativeSource,relative),adapted);adaptations.push({file:relative,upstreamSha256:digest(original),policySha256:digest(effective),nativeSha256:digest(adapted)});}
  await copyFile(path.join(here,'mac-windows-transport.mjs'),path.join(nativeSource,'codex-profile/mac/hooks/mac-windows-transport.mjs'));
  await write(path.join(root,'skill-registry/mac-source.json'),JSON.stringify({commit:PIN,branch:'codex/macos-global-deploy',source:rawSource,nativeSource,library,python,modelCache,backup,adaptations,...policy},null,2)+'\n');
  console.log(JSON.stringify({phase:'backed-up',backup,commit:PIN}));
 }
 const installed=await run(process.execPath,[path.join(nativeSource,'scripts/install-codex-profile-mac.mjs'),'--home',home,'--json',...(check?['--check']:[])],{env});
 console.log(installed.stdout.trim());
 const search=await run(process.execPath,[path.join(nativeSource,'scripts/install-technical-research.mjs'),'--home',home,'--json',...(check?['--check']:[])],{env});
 console.log(search.stdout.trim());
 if(check){await registerTaskTreeRuntime(root,{check:true});console.log(JSON.stringify({phase:'worker-residency-checked',...await ensureWarmWorker(root,{start:false})}));return;}
 if(!(await readFile(path.join(root,'config.toml'),'utf8')).includes('[mcp_servers.task_tree]')){
  const mcp=await run(process.execPath,[path.join(nativeSource,'scripts/install-task-tree-mcp-mac.mjs'),'--home',home,'--json'],{env});
  console.log(mcp.stdout.trim());
 }
 await registerTaskTreeRuntime(root);
 const active=JSON.parse(await readFile(path.join(root,'skill-registry/mac-source.json'),'utf8'));
 await prepareRoutingIndex(root,active);
 await copyFile(path.join(nativeSource,'scripts/parallel-run.mjs'),path.join(root,'tools/parallel-run.mjs'));
 console.log(JSON.stringify({phase:'worker-prewarmed',...await ensureWarmWorker(root)}));
 // Retire only the old platform-specific modules that this repository installed.
 const manifest=JSON.parse(await readFile(path.join(root,'skill-registry/mac-source.json'),'utf8'));
 for(const name of ['graph-client.mjs','skill-metadata.mjs'])if(await exists(path.join(root,'hooks',name))){await mkdir(path.join(manifest.backup,'retired-windows'),{recursive:true});await rename(path.join(root,'hooks',name),path.join(manifest.backup,'retired-windows',name));}
 console.log(JSON.stringify({phase:'profile-installed',commit:PIN,automaticUse:'requires Codex Hook trust; no hashes approved by installer'}));
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
