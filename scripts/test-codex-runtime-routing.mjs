#!/usr/bin/env node
// Real ephemeral Codex turn: no bypass flags, no shared daemon restart.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { verifyCpuEvidence } from './runtime-cpu-evidence.mjs';
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
assert.ok(args.includes('--bin'), '--bin is required');
const cwd = args.includes('--cwd') ? option('--cwd') : '/tmp';
const child = spawn(option('--bin'), ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'] });
let sequence = 0, buffer = '', threadId;
const pending = new Map(), runs = [], items = [];
const started = Date.now();
const send = x => child.stdin.write(JSON.stringify(x) + '\n');
const request = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); send({ id, method, params });
});
let complete;
const finished = new Promise(resolve => { complete = resolve; });
child.stdout.on('data', data => {
  buffer += data;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    let message; try { message = JSON.parse(line); } catch { continue; }
    if (pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id);
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
    if (message.method === 'hook/completed') {
      const run = message.params.run;
      const text = (run.entries || []).map(x => x.text).join('\n');
      const record = { event: run.eventName, status: run.status, durationMs: run.durationMs,
        routed: text.includes('CODEX_SKILL_ROUTER_V2'), fixed: text.includes('GLOBAL_ALWAYS_ON_ORIGINAL_EN'),
        error: (run.entries || []).some(x => x.kind === 'error' || x.kind === 'warning') };
      runs.push(record); console.log(JSON.stringify({ hook: record }));
    }
    if (message.method === 'item/completed') {
      const item = message.params.item;
      items.push({ id: item.id, type: item.type, command: item.command, exitCode: item.exitCode,
        durationMs: item.durationMs, text: item.type === 'agentMessage' ? item.text : undefined,
        output: item.type === 'commandExecution' ? item.aggregatedOutput : undefined });
    }
    if (message.method === 'turn/completed') complete(message.params.turn);
  }
});
// Never print backend stderr; it can contain provider/session-local information.
child.stderr.resume();
const timeout = setTimeout(() => { console.error('runtime verification timed out'); child.kill(); process.exitCode = 1; complete({ status: 'timeout' }); }, 180000);
try {
  await request('initialize', { clientInfo: { name: 'global-graph-deployment-smoke', version: '1' }, capabilities: { experimentalApi: true } });
  send({ method: 'initialized' });
  const listed = await request('hooks/list', { cwds: [cwd] });
  const hooks = listed.data.flatMap(row => row.hooks).filter(x => ['userPromptSubmit', 'sessionStart'].includes(x.eventName));
  assert.equal(hooks.length, 2);
  assert.ok(hooks.every(x => x.enabled && x.trustStatus === 'trusted'));
  const config = (await request('config/read', { includeLayers: false, cwd })).config;
  assert.equal(config.features.multi_agent, true);
  assert.equal(config.agents.max_concurrent_threads_per_session, 20);
  console.log(JSON.stringify({ trustedHooks: hooks.map(x => x.eventName), maxAgentThreads: 20, model: config.model }));
  const thread = await request('thread/start', { cwd, ephemeral: true, sandbox: 'read-only' });
  threadId = thread.thread.id;
  await request('turn/start', { threadId, input: [{ type: 'text', text: '部署验收：这是隔离的只读测试，请勿修改文件、访问外网或创建子Agent。请在同一次终端调用内运行一个父Node进程，由它用child_process.spawn并行启动4个独立Node子进程，各自进行约200毫秒的有限CPU计算，并输出父进程记录的child.pid及子进程的起止时间，每行固定格式 PID=数字 START_MS=数字 END_MS=数字；最后依据实测区间报告峰值重叠数。不要输出任何环境变量、认证或用户数据。' }] });
  const turn = await finished;
  const promptRun = runs.find(x => x.event === 'userPromptSubmit');
  assert.ok(promptRun && promptRun.status === 'completed' && promptRun.routed && !promptRun.error, 'runtime must actually execute the indexed router');
  assert.equal(turn.status, 'completed', JSON.stringify(turn.error || turn.status));
  const cpuEvidence = verifyCpuEvidence(items);
  const report = { success: true, seconds: (Date.now() - started) / 1000, runs, cpuEvidence,
    items: items.map(({ type, exitCode, durationMs }) => ({ type, exitCode, durationMs })) };
  if (args.includes('--output')) await writeFile(option('--output'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  clearTimeout(timeout); child.kill();
}
