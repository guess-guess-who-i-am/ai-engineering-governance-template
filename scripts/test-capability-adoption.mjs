import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const file = new URL('../codex-profile/.codex/hooks/skill-router.mjs', import.meta.url);
const source = await readFile(file, 'utf8');
const start = source.indexOf('function capabilityAction(');
assert(start >= 0, 'a selected capability must have an execution decision, not only a candidate card');
const end = source.indexOf('\nfunction workerSocketPath(', start);
const action = vm.runInNewContext(source.slice(start, end) + '\ncapabilityAction');
const research = { skill: { name: 'technical_research_batch', kind: 'mcp', mcpServer: 'technical_research' } };
const ordinary = { skill: { name: 'ordinary', kind: 'skill', path: '/fixture/SKILL.md' } };
assert.equal(action([]), '');
assert.equal(action([ordinary, research]), '', 'a lower incidental candidate must not add a standing policy');
assert.equal(action([{skill:{...research.skill,mcpServer:'unrelated'}}]), '', 'same tool name on another server is not the owned capability');
assert(action([research]).includes('[SELECTED_CAPABILITY_ACTION_V1]'));
assert(action([research]).includes('1–20'));
assert(action([research]).includes('user forbids'));
assert(action([research]).length < 1100, 'conditional adoption must stay small');

// Run the real Hook entry against an isolated registry: no model or network.
const root = await mkdtemp(path.join(os.tmpdir(), 'capability-adoption-'));
await mkdir(path.join(root, 'skill-registry'));
await writeFile(path.join(root, 'skill-registry/skills-index.json'), JSON.stringify({skills:[]}));
await writeFile(path.join(root, 'skill-registry/routing-rules.json'), '{}');
await writeFile(path.join(root, 'skill-registry/mcp-tools.json'), JSON.stringify({tools:[{
  name:'technical_research_batch',server:'technical_research',description:'Batch technical research across Stack Overflow and GitHub repositories'
}]}));
const run = prompt => {
 const result=spawnSync(process.execPath,[fileURLToPath(file)],{
  encoding:'utf8',windowsHide:true,input:JSON.stringify({hook_event_name:'UserPromptSubmit',prompt,cwd:root}),
  env:{...process.env,CODEX_HOME:root}
 });
 assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
 return JSON.parse(result.stdout).hookSpecificOutput?.additionalContext||'';
};
const selected=run('technical_research_batch');
assert.equal((selected.match(/\[SELECTED_CAPABILITY_ACTION_V1\]/g)||[]).length,1);
assert(selected.includes('technical_research/technical_research_batch'));
assert.equal(run('你好'),'');
console.log('PASS: only the top owned capability gains a bounded execution route; real Hook output and greeting exclusion verified.');
