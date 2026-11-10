#!/usr/bin/env node
// Only starts the versioned v12 broker. All fixture writes stay in one mkdtemp.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ide = process.argv[2];
if (!ide || !path.isAbsolute(ide)) throw new Error('Pass the installed IDE absolute directory');
const source = path.join(ide, 'server/shared-agent-worker.js');
if (!(await readFile(source, 'utf8')).includes(':runtime-v12-external-skills-isolated-root')) throw new Error('Requires the isolated v12 broker, not the production legacy socket');
const { createSharedAgentRuntime, sharedAgentSocket } = await import(pathToFileURL(source));
const home = path.join(os.homedir(), '.codex');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'global-v12-compatibility-'));
const owner = path.join(scratch, 'owner'); await mkdir(owner);
const sha = text => createHash('sha256').update(text).digest('hex');
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
const envCode = 'console.log(JSON.stringify({cwd:process.cwd(),root:process.env.TASK_TREE_PROJECT_ROOT,owner:process.env.TASK_TREE_OWNER_PROJECT_ROOT}))';
const command = `${quote(process.execPath)} -e ${quote(envCode)}`;
const candidates = await Promise.all(['candidate-a', 'candidate-b'].map(async name => {
  const cwd = path.join(scratch, name); await mkdir(path.join(cwd, '.codex'), { recursive: true });
  await writeFile(path.join(cwd, 'task-tree.md'), '# LLM Task Graph\n\n## ROOT - 隔离兼容性探针\n\n- Completion: 进行中\n- Problem: 只读核对当前隔离目录。\n- Approach: 不执行生产任务。\n- Metrics: 返回自己的目录。\n\n# GraphState\n\n- Current: ROOT\n- Next: ROOT\n- NextPlan: \n\n# Edges\n');
  const hook = path.join(cwd, 'audit-env.mjs');
  await writeFile(hook, 'console.log(JSON.stringify({hookSpecificOutput:{additionalContext:"[AUDIT_ROOT]"+JSON.stringify({cwd:process.cwd(),root:process.env.TASK_TREE_PROJECT_ROOT,owner:process.env.TASK_TREE_OWNER_PROJECT_ROOT})}}));\n');
  await writeFile(path.join(cwd, '.codex/hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${quote(process.execPath)} ${quote(hook)}`, parallelSafe: true }] }] } }));
  return cwd;
}));
const report = { measuredAt: new Date().toISOString(), node: process.version, scratch, owner, runtimeSocket: sharedAgentSocket(home), sessions: [], checks: [] };
const check = (name, passed) => { report.checks.push({ name, passed }); assert.ok(passed, name); };
const clients = [];
try {
  const started = performance.now();
  const opened = await Promise.all(candidates.map(cwd => createSharedAgentRuntime({ cwd, codexHome: home, environment: { CODEX_HOME: home, TASK_TREE_PROJECT_ROOT: owner } })));
  clients.push(...opened);
  report.openWallMs = Math.round(performance.now() - started);
  check('two candidates reuse the same v12 broker', opened[0].worker.pid === opened[1].worker.pid);
  check('v12 never reuses legacy production broker 661', opened.every(client => client.worker.pid !== 661));
  const prompt = 'postgresql database performance query index optimization audit 20261018';
  const hookStart = performance.now();
  const hooks = await Promise.all(opened.map((client, number) => client.hooks('UserPromptSubmit', { prompt, session_id: `v12-audit-${process.pid}-${number}`, turn_id: '1' })));
  report.hookWallMs = Math.round(performance.now() - hookStart);
  for (let i = 0; i < opened.length; i++) {
    const client = opened[i], cwd = candidates[i], hook = hooks[i];
    check(`session ${i} runs global routed Hook`, hook.context.includes('[CODEX_SKILL_ROUTER_V2]') && !hook.blocked && hook.reports.every(item => item.ok && !item.stderr));
    const envHook = JSON.parse(hook.context.match(/^\[AUDIT_ROOT\](.+)$/m)?.[1] || '{}');
    report.lastHookEnvironment = envHook;
    check(`session ${i} Hook keeps the isolated cwd and owner`, await realpath(envHook.cwd) === await realpath(cwd) && envHook.root === cwd && envHook.owner === owner);
    const exec = await client.call('exec_command', { command });
    const envTool = JSON.parse(exec.stdout);
    report.lastToolEnvironment = envTool;
    check(`session ${i} shell uses isolated root`, exec.ok && await realpath(envTool.cwd) === await realpath(cwd) && envTool.root === cwd && envTool.owner === owner);
    const focus = await client.call('task_tree_focus', {});
    check(`session ${i} actual MCP uses isolated root`, focus.projectRoot === cwd);
    const exact = [...hook.context.matchAll(/^\s+Read: (.+)$/gm)].map(match => match[1]).find(file => file.startsWith(path.join(home, 'tools/skills') + path.sep));
    check(`session ${i} receives an external path`, !!exact);
    const readStart = performance.now();
    const skill = await client.call('skills_read', { name: exact });
    const readMs = Math.round(performance.now() - readStart);
    check(`session ${i} reads the entire routed external Skill`, skill.source === 'external-library' && sha(skill.content) === sha(await readFile(exact)));
    const localOnly = await client.call('skills_list', {});
    check(`session ${i} empty discovery avoids a 15k catalog dump`, !localOnly.skills.some(skill => skill.source === 'external-library'));
    const listStart = performance.now();
    const discovered = await client.call('skills_list', { query: path.basename(path.dirname(exact)) });
    const listMs = Math.round(performance.now() - listStart);
    check(`session ${i} lazy name discovery includes the routed external Skill`, discovered.skills.some(skill => skill.path === exact));
    const denied = [];
    for (const name of [path.join(scratch, 'SKILL.md'), path.join(home, 'tools/skills/_catalog_cn.json'), path.join(home, 'tools/skills-escape/demo/SKILL.md')]) {
      try { await client.call('skills_read', { name }); denied.push(false); } catch { denied.push(true); }
    }
    check(`session ${i} rejects outside/non-Skill paths`, denied.every(Boolean));
    report.sessions.push({ cwd, worker: client.worker, entrySkillCount: client.skillCount, systemBytes: Buffer.byteLength(client.systemPrompt), indexFile: client.indexFile, hookSources: client.hookSources,
      hookReports: hook.reports.map(({ source, durationMs, ok }) => ({ source, durationMs, ok })), envHook, envTool, focusRoot: focus.projectRoot,
      externalRead: { path: exact, bytes: Buffer.byteLength(skill.content), sha256: sha(skill.content), readMs }, discovery: { localOnlyCount: localOnly.skills.length, matchingCount: discovered.skills.length, listMs } });
  }
  const graph = JSON.parse(await readFile(path.join(home, 'skill-registry/external-skills-manifest.json'), 'utf8')).graphPath;
  const socketPath = path.join('/tmp', `codex-graph-${process.getuid()}`, `${sha(graph).slice(0, 24)}.sock`);
  const graphResponse = await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let buffer = '';
    socket.setEncoding('utf8'); socket.setTimeout(55000, () => socket.destroy(new Error('graph timeout'))); socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ query: prompt, top_k: 8, deadline: Date.now() + 55000 }) + '\n'));
    socket.on('close', () => { if (!buffer.includes('\n')) reject(new Error('graph closed without response')); });
    socket.on('data', chunk => { buffer += chunk; if (buffer.includes('\n')) { socket.end(); resolve(JSON.parse(buffer.slice(0, buffer.indexOf('\n')))); } });
  });
  report.graph = { socket: socketPath, pid: graphResponse.pid, queryPid: graphResponse.queryPid, loads: graphResponse.loads, prefilter: graphResponse.prefilter };
  check('existing global graph supervisor 687 is reused', graphResponse.ok && graphResponse.pid === 687 && graphResponse.loads === 1 && graphResponse.prefilter);
  report.ok = true;
} catch (error) { report.ok = false; report.error = error.message; process.exitCode = 1; }
finally { await Promise.all(clients.map(client => client.close())); }
await writeFile(path.join(scratch, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
