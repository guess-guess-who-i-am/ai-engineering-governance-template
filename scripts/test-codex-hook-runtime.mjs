import {spawn} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {summarizeCodexLatency} from './codex-latency.mjs';
import {WebSearchEvidence} from './web-search-evidence.mjs';
import {retestDiagnostics,retestFailures} from './codex-retest-diagnostics.mjs';

const cwd=process.cwd();
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--cwd'||args[2]!=='--prompt')throw new Error('Usage: node scripts/test-codex-hook-runtime.mjs --cwd <fixture> --prompt <ordinary query>');
const fixture=path.resolve(args[1]);
const prompt=args[3];
const timeoutMs=Number(process.env.CODEX_TEST_TIMEOUT_MS||240000);
if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>240000)throw new Error('CODEX_TEST_TIMEOUT_MS must be 1000–240000');
const threadConfig=process.env.CODEX_TEST_THREAD_CONFIG?JSON.parse(process.env.CODEX_TEST_THREAD_CONFIG):{};
const recordedOverrideKeys=['model_providers.custom.request_max_retries','model_providers.custom.stream_max_retries','web_search'];
const testOverrides=Object.fromEntries(recordedOverrideKeys.filter(key=>Object.hasOwn(threadConfig,key)).map(key=>[key,threadConfig[key]]));
await mkdir(path.join(cwd,'.reports'),{recursive:true});
const markers=['ADAPTIVE_TOOL_SCHEDULING_CONTRACT_V4','GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3','CODEX_SKILL_ROUTER_V2'];
const child=spawn('codex',['app-server','--stdio'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const events=[],hooks=[],commands=new Map(),messages=[],nativeTimings=[],webSearches=[];
const webEvidence=new WebSearchEvidence();
let buffer='',stderr='',threadId='',settled=false,modelResolution={};
const started=Date.now();
const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
const finish=async(error)=>{
 if(settled)return;settled=true;clearTimeout(timer);
 child.kill();
 const final=messages.filter(x=>x.phase==='final_answer').map(x=>x.text).join('\n');
 const combined=hooks.flatMap(h=>h.entries||[]).map(e=>e.text||'').join('\n');
 const timings=[...commands.values()].filter(c=>c.startedAt&&c.completedAt).flatMap(c=>[[c.startedAt,1],[c.completedAt,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 let active=0,maxConcurrentCommands=0;for(const [,delta]of timings){active+=delta;maxConcurrentCommands=Math.max(maxConcurrentCommands,active);}
 const nativeEvents=nativeTimings.flatMap(x=>[[x.startedAt,1],[x.endedAt,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 let nativeActive=0,maxNativeChildConcurrency=0;for(const [,delta]of nativeEvents){nativeActive+=delta;maxNativeChildConcurrency=Math.max(maxNativeChildConcurrency,nativeActive);}
 const evidence={threadId,fixture,prompt,elapsedMs:Date.now()-started,success:!error,error:error?.message||'',markers:Object.fromEntries(markers.map(m=>[m,combined.includes(m)])),hooks:hooks.map(h=>({eventName:h.eventName,status:h.status,source:h.source,durationMs:h.durationMs,markers:markers.filter(m=>(h.entries||[]).some(e=>e.text?.includes(m)))})),commands:[...commands.values()],maxConcurrentCommands,nativeTimings,maxNativeChildConcurrency,webSearches,maxSearchBatchQueries:Math.max(0,...webSearches.filter(x=>x.action?.type==='search').map(x=>Array.isArray(x.action.queries)?x.action.queries.length:x.action.query?1:0)),final,finalChars:Array.from(final).length,visibleFinalChars:Array.from(final.replace(/\[([^\]]*)\]\([^)]*\)/g,'$1')).length,stderr:stderr.slice(-2500)};
 evidence.latency=summarizeCodexLatency(events,started,Date.now());
 evidence.diagnostics=retestDiagnostics(events,stderr);
 evidence.modelResolution=modelResolution;evidence.testConditions={timeoutMs,testOverrides,requiredTechnicalResearch:process.env.CODEX_TEST_REQUIRE_TECHNICAL_RESEARCH==='1'};
 evidence.technicalResearchCalls=events.filter(e=>e.method==='item/completed'&&e.params?.item?.type==='mcpToolCall'&&e.params.item.server==='technical_research').map(e=>{
  const item=e.params.item;const text=(item.result?.content||[]).filter(c=>c.type==='text').map(c=>c.text||'').join('\n');
  let result;try{result=JSON.parse(text);}catch{}
  return {id:item.id,tool:item.tool,arguments:item.arguments,status:item.status,durationMs:item.durationMs,
   returnedCount:result?.returnedCount,selectedCount:result?.selected?.length,cacheHits:result?.cacheHits,
   batchStatus:result?.status,artifact:result?.artifact,returnedTextChars:Array.from(text).length};
 });
 evidence.webEvidence=await webEvidence.save(path.join(cwd,'.reports'));
 evidence.failures=retestFailures({runtimeError:error?.message,markers:evidence.markers,final,hooks,
  requireTechnicalResearch:process.env.CODEX_TEST_REQUIRE_TECHNICAL_RESEARCH==='1',technicalResearchCalls:evidence.technicalResearchCalls});
 if(process.env.CODEX_TEST_REQUIRE_WEB_EVIDENCE==='1'&&!evidence.webEvidence.complete)evidence.failures.push('Web result/body evidence is incomplete; native completion is not evidence of result visibility');
 evidence.success=evidence.failures.length===0;evidence.error=evidence.failures.join('; ');
 await writeFile(path.join(cwd,'.reports/trusted-hook-live-events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n')+'\n');
 await writeFile(path.join(cwd,'.reports/trusted-hook-live-result.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence,null,2));process.exitCode=evidence.success?0:1;
};
const timer=setTimeout(()=>{if(threadId&&activeTurnId)send({id:99,method:'turn/interrupt',params:{threadId,turnId:activeTurnId}});finish(new Error('Live test exceeded '+timeoutMs+' milliseconds'));},timeoutMs);
let activeTurnId='';
child.on('error',finish);child.stderr.on('data',chunk=>stderr+=chunk);
child.on('exit',code=>{if(!settled)finish(new Error('App server exited early: '+code));});
child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){let msg;try{msg=JSON.parse(buffer.slice(0,end));}catch{}buffer=buffer.slice(end+1);if(!msg)continue;
 const observed={at:Date.now(),...msg};webEvidence.observe(observed);events.push(webEvidence.safeEvent(observed));
 if(msg.error){finish(new Error(JSON.stringify(msg.error)));continue;}
 if(msg.id===1){send({method:'initialized'});send({id:2,method:'hooks/list',params:{cwds:[cwd]}});}
 if(msg.id===2){const users=(msg.result?.data||[]).flatMap(d=>d.hooks).filter(h=>h.source==='user'&&['sessionStart','userPromptSubmit'].includes(h.eventName));if(users.length!==2||users.some(h=>!h.enabled||h.trustStatus!=='trusted')){finish(new Error('Two enabled trusted user Hooks are required'));continue;}console.log('Both user Hooks are enabled and trusted');send({id:3,method:'thread/start',params:{cwd:fixture,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',experimentalRawEvents:true,...(Object.keys(threadConfig).length?{config:threadConfig}:{})}});}
 if(msg.id===3){threadId=msg.result?.thread?.id;if(!threadId){finish(new Error('No new thread ID'));continue;}modelResolution={model:msg.result.model,provider:msg.result.modelProvider,reasoningEffort:msg.result.reasoningEffort};console.log('New isolated natural task: '+threadId);send({id:4,method:'turn/start',params:{threadId,input:[{type:'text',text:prompt}]}});}
 if(msg.id===4)activeTurnId=msg.result?.turn?.id||'';
 if(msg.method==='hook/completed'){hooks.push(msg.params.run);console.log(JSON.stringify({hook:msg.params.run.eventName,status:msg.params.run.status,durationMs:msg.params.run.durationMs,entries:msg.params.run.entries?.length||0}));}
 if(msg.method==='item/started'&&msg.params?.item?.type==='commandExecution'){const item=msg.params.item;commands.set(item.id,{id:item.id,command:item.command,startedAt:Date.now()});console.log('Tool: '+item.command);}
 if(msg.method==='item/completed'&&msg.params?.item?.type==='webSearch'){const item=msg.params.item;webSearches.push({id:item.id,query:item.query,action:item.action,completedAt:Date.now()});console.log('Web action: '+JSON.stringify(item.action));}
 if(msg.method==='item/completed'){const item=msg.params?.item;if(item?.type==='commandExecution'){commands.set(item.id,{...commands.get(item.id),command:item.command,completedAt:Date.now(),exitCode:item.exitCode});for(const match of (item.aggregatedOutput||'').matchAll(/TEST_CHILD_TIMING (\{[^\n]+\})/g)){try{nativeTimings.push(JSON.parse(match[1]));}catch{}}}if(item?.type==='agentMessage')messages.push(item);}
 if(msg.method==='turn/completed')finish(msg.params.turn?.status==='completed'?null:new Error('Turn status: '+msg.params.turn?.status));
}});
send({id:1,method:'initialize',params:{clientInfo:{name:'trusted-hook-live-test',version:'1.0.0'},capabilities:{experimentalApi:true}}});
