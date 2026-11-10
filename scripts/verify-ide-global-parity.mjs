#!/usr/bin/env node
// Opt-in live consumer verification. No model calls or configuration writes.
// The comparison snapshot must come from Codex app-server skills/list, not the
// truncated routing registry. Hook cadence state is private to this test.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const {values}=parseArgs({options:{'ide-runtime':{type:'string'},'native-skills-json':{type:'string'},output:{type:'string'}}});
assert(values['ide-runtime'] && values['native-skills-json'], 'Pass the actual IDE runtime and an independent Codex skills/list JSON snapshot');
const native=JSON.parse(await readFile(values['native-skills-json'],'utf8')).result?.data?.[0];
assert(Array.isArray(native?.skills) && !native.errors?.length, 'Native inventory is missing or has discovery errors');
const expected=native.skills.filter(skill=>skill.enabled!==false);
assert(expected.length>0, 'Cannot verify against an empty inventory');
const sha=text=>createHash('sha256').update(text).digest('hex');
const runtimePath=path.resolve(values['ide-runtime']);
const sourceNames=['agent-runtime.js','codex-resource-parity.js','global-execution-profile.js','external-skill-catalog.js','global-mcp.js'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceNames.map(async name=>[name,sha(await readFile(path.join(path.dirname(runtimePath),name)))])));
const {createAgentRuntime}=await import(pathToFileURL(runtimePath));
const codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
const configFile=path.join(codexHome,'config.toml');
const configSha=sha(await readFile(configFile));
const index=JSON.parse(await readFile(path.join(codexHome,'skill-registry/external-skills-manifest.json'),'utf8'));
const registry=JSON.parse(await readFile(path.join(codexHome,'skill-registry/resource-modules.json'),'utf8'));
const experts=registry.modules.filter(module=>module.kind==='expert');
const temp=await mkdtemp(path.join(os.tmpdir(),'ide-global-parity-'));
const sessions=[];
try {
  const outcomes=await Promise.allSettled([0,1].map(async number=>{
    const cwd=path.join(temp,`workspace-${number}`);await mkdir(cwd);
    const session=`global-parity-${process.pid}-${number}-${path.basename(temp)}`;sessions.push(session);
    const started=Date.now();
    const runtime=await createAgentRuntime({cwd,codexHome,treeBridgeFactory:async()=>({tools:[],instructions:'',close:async()=>{}})});
    try {
      const status=await runtime.call('global_config_status',{});
      assert.equal(status.source,configFile);assert.equal(status.sha256,configSha);
      assert.equal(status.agents.configuredLimit,20);assert.equal(status.agents.hostLimit,20);
      assert.equal(status.skillCatalog.source,'codex-app-server-skills/list');
      assert.equal(status.skillCatalog.total,expected.length);
      assert(status.skillCatalog.used<=status.skillCatalog.limit);
      assert.equal(status.resources.experts.registered,experts.length);
      assert.deepEqual(runtime.hookSources,[path.join(codexHome,'hooks.json')]);
      assert.deepEqual(runtime.instructionSources.map(source=>source.path),[path.join(codexHome,'AGENTS.md')]);
      assert.equal(runtime.instructionSources[0].sha256,sha(await readFile(path.join(codexHome,'AGENTS.md'))));
      for(const skill of expected) {
        const result=await runtime.call('skills_list',{query:skill.name});
        const exact=result.skills.find(entry=>entry.path===skill.path);
        assert(exact,`IDE omitted native Skill ${skill.name}`);
        assert.equal(exact.description,skill.description,`IDE changed native metadata for ${skill.name}`);
      }
      const cadence=[];
      for(let turn=1;turn<=4;turn++) {
        const result=await runtime.hooks('UserPromptSubmit',{session_id:session,turn_id:String(turn),prompt:'请使用 $desktop-task-workflow 创建报告并交付文件'});
        assert.equal(result.blocked,false);assert(result.reports.every(report=>report.ok));
        for(const report of result.reports)assert(!/routing failed|startup failed|timed out/i.test(report.stderr||''),report.stderr);
        assert(result.context.includes('desktop-task-workflow'),'Every turn must route the current task');
        const includes=result.context.includes('[ADAPTIVE_TOOL_SCHEDULING_CONTRACT_V5]');
        assert.equal(includes,turn===1||turn===4,'Live IDE must preserve three-turn cadence');cadence.push(includes);
      }
      assert.equal(sha(await readFile(configFile)),configSha,'Configuration changed during verification');
      return {workspace:number,started,ended:Date.now(),nativeMetadataMatched:expected.length,configSha256:configSha,
        instructionSources:runtime.instructionSources.map(source=>source.path),hookSources:runtime.hookSources,
        skillCatalog:status.skillCatalog,agents:status.agents,experts:experts.length,cadence};
    } finally {await runtime.close();}
  }));
  const failures=outcomes.filter(result=>result.status==='rejected');
  if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'IDE global parity failed');
  const rows=outcomes.map(result=>result.value);
  assert(rows[0].started<rows[1].ended && rows[1].started<rows[0].ended,'Workspace checks must overlap');
  for(const name of sourceNames)assert.equal(sha(await readFile(path.join(path.dirname(runtimePath),name))),sourceHashes[name],`IDE source changed during verification: ${name}`);
  const result={passed:true,modelWorkflowExecuted:false,waveWidth:2,retries:0,timeouts:0,skipped:0,
    runtime:runtimePath,sourceHashes,graph:{skills:index.skillCount,resources:index.resourceModuleCount,mcpTools:index.mcpToolCount},rows};
  if(values.output)await writeFile(values.output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {
  await rm(temp,{recursive:true,force:true});
  for(const session of sessions)await rm(path.join(codexHome,'hooks/cadence-state',sha(session)+'.json'),{force:true});
}
