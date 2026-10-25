#!/usr/bin/env node
// Observe natural scheduling through the real Codex runtime; no replayed hooks.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateJobs(items, count = 8) {
  const rows = [];
  for (const item of items) {
    if (item.type !== 'commandExecution' || item.exitCode !== 0) continue;
    for (const line of String(item.output || '').split('\n')) {
      if (!line.startsWith('BENCH_JOB ')) continue;
      const row = JSON.parse(line.slice(10));
      if (!Number.isInteger(row.id) || row.id < 1 || row.id > count || !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.end - row.start < 380) throw new Error('Invalid measured work interval');
      const expected = createHash('sha256').update(`ready-work:${row.id}`).digest('hex');
      if (row.digest !== expected) throw new Error('Incorrect job result');
      rows.push(row);
    }
  }
  if (rows.length !== count || new Set(rows.map(x => x.id)).size !== count) throw new Error(`Expected ${count} distinct successful jobs; got ${rows.length}`);
  const peak = Math.max(...rows.map(row => rows.filter(other => other.start <= row.start && row.start < other.end).length));
  const workSpanMs = Math.max(...rows.map(x => x.end)) - Math.min(...rows.map(x => x.start));
  const sumWorkMs = rows.reduce((n, x) => n + x.end - x.start, 0);
  return { jobs: rows.sort((a, b) => a.id - b.id), peak, workSpanMs, sumWorkMs, overlapRatio: sumWorkMs / workSpanMs };
}

export async function benchmark({ bin, workspace, output, label = 'observed', timeoutMs = 360000 }) {
  const cwd = workspace || await mkdtemp(path.join(os.tmpdir(), 'codex-ready-work-'));
  if (!workspace) {
    const checker = `import { createHash } from 'node:crypto';\nconst id=Number(process.argv[2]);if(!Number.isInteger(id)||id<1||id>8)process.exit(2);const start=Date.now();let n=1;while(Date.now()-start<400){for(let i=0;i<10000;i++)n=(n*1664525+1013904223)>>>0;}const end=Date.now();console.log('BENCH_JOB '+JSON.stringify({id,start,end,digest:createHash('sha256').update('ready-work:'+id).digest('hex')}));\n`;
    await writeFile(path.join(cwd, 'check.mjs'), checker, { mode: 0o600 });
  } else {
    await readFile(path.join(cwd, 'check.mjs'));
  }
  const began = Date.now();
  const report = { schema: 'codex-ready-work/v1', label, workspace: cwd, success: false, phases: [], hooks: [], items: [] };
  const items = [], pending = new Map();
  let buffer = '', sequence = 0, threadId, turnId, done;
  const finished = new Promise(resolve => { done = resolve; });
  const child = spawn(bin, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject }); send({ id, method, params });
  });
  const phase = (event, detail = {}) => {
    const record = { event, ms: Date.now() - began, ...detail };
    report.phases.push(record); console.log(JSON.stringify(record));
  };
  const finishError = error => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear(); done({ status: 'transport-error' });
  };
  child.on('error', finishError);
  child.on('exit', code => { if (code !== 0) finishError(new Error('Codex transport ended')); });
  child.stderr.resume(); // Provider diagnostics can contain private session data.
  child.stdout.on('data', data => {
    buffer += data;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (pending.has(message.id)) {
        const entry = pending.get(message.id); pending.delete(message.id);
        message.error ? entry.reject(new Error('Codex request failed: ' + message.error.code)) : entry.resolve(message.result);
      } else if (message.id !== undefined && message.method) {
        // The fixture needs no permission expansion. Do not silently approve any.
        send({ id: message.id, error: { code: -32601, message: 'Benchmark cannot approve permission expansion' } });
        phase('unexpected-approval', { method: message.method });
      }
      if (message.method === 'hook/completed') {
        const run = message.params.run;
        const context = (run.entries || []).map(x => x.text).join('\n');
        const record = { event: run.eventName, durationMs: run.durationMs, status: run.status,
          routed: context.includes('CODEX_SKILL_ROUTER_V2'), fixed: context.includes('GLOBAL_ALWAYS_ON_ORIGINAL_EN'),
          schedulingVersion: context.match(/\[(?:ADAPTIVE_TOOL_SCHEDULING|AUTOMATIC_TOOL_BATCHING)_CONTRACT_V\d+\]/)?.[0] || '',
          contextBytes: Buffer.byteLength(context), error: (run.entries || []).some(x => x.kind === 'error' || x.kind === 'warning') };
        report.hooks.push(record); phase('hook', record);
      }
      if (message.method === 'item/started') phase('item-start', { type: message.params.item.type, id: message.params.item.id });
      if (message.method === 'item/completed') {
        const item = message.params.item;
        items.push({ id: item.id, type: item.type, exitCode: item.exitCode, durationMs: item.durationMs, output: item.type === 'commandExecution' ? item.aggregatedOutput : undefined });
        report.items.push({ id: item.id, type: item.type, exitCode: item.exitCode, durationMs: item.durationMs,
          commandSha256: item.command ? createHash('sha256').update(item.command).digest('hex') : undefined,
          fixtureCommand: Boolean(item.command?.includes('check.mjs')), skillRead: Boolean(item.command?.includes('SKILL.md')),
          gitProbe: /\bgit\s/.test(item.command || ''),
          failureCategory: item.exitCode ? ['not a git repository', 'Permission denied', 'command not found', 'No such file or directory', 'failed to spawn', 'execution denied'].find(x => String(item.aggregatedOutput || '').includes(x)) || 'unclassified' : undefined });
        phase('item-complete', { type: item.type, id: item.id, exitCode: item.exitCode, durationMs: item.durationMs });
      }
      if (message.method === 'thread/tokenUsage/updated') report.usage = message.params.tokenUsage?.total;
      if (message.method === 'turn/completed') done(message.params.turn);
    }
  });
  const timer = setTimeout(() => {
    phase('deadline');
    done({ status: 'timeout' });
    for (const entry of pending.values()) entry.reject(new Error('Runtime deadline exceeded'));
    pending.clear();
  }, timeoutMs);
  try {
    await request('initialize', { clientInfo: { name: 'ready-work-scheduling-benchmark', version: '1' }, capabilities: { experimentalApi: true } });
    send({ method: 'initialized' });
    const listed = await request('hooks/list', { cwds: [cwd] });
    report.hookTrust = listed.data.flatMap(row => row.hooks).filter(x => ['sessionStart', 'userPromptSubmit'].includes(x.eventName)).map(x => ({ event: x.eventName, enabled: x.enabled, trustStatus: x.trustStatus }));
    if (report.hookTrust.length !== 2 || !report.hookTrust.every(x => x.enabled && x.trustStatus === 'trusted')) throw new Error('Both global hooks must already be trusted');
    const config = (await request('config/read', { includeLayers: false, cwd })).config;
    report.configuration = { model: config.model, reasoning: config.model_reasoning_effort, multiAgent: config.features?.multi_agent, maxThreads: config.agents?.max_concurrent_threads_per_session };
    const thread = await request('thread/start', { cwd, ephemeral: true, sandbox: 'read-only' });
    threadId = thread.thread.id;
    phase('thread-ready');
    const prompt = `这是一次隔离的只读验收任务，不是修改工程：在当前目录，使用现有的Node程序check.mjs分别核验编号1到8的八个独立批次（调用格式：${process.execPath} check.mjs 编号）。每个编号恰好执行一次，收集八条原始BENCH_JOB结果，并给出成功数。不创建子Agent，不修改文件，不访问外网，不读取环境变量或认证；不需要搜索资料或设计额外测试。`;
    report.promptSha256 = createHash('sha256').update(prompt).digest('hex');
    const turn = await request('turn/start', { threadId, input: [{ type: 'text', text: prompt }] });
    turnId = turn.turn.id;
    const result = await finished;
    report.status = result.status;
    if (result.status !== 'completed') throw new Error('Turn ' + result.status);
    report.measurement = validateJobs(items);
    const routed = report.hooks.find(x => x.event === 'userPromptSubmit');
    if (!routed || !routed.routed || routed.error) throw new Error('Real global routing must execute');
    report.success = true;
  } catch (error) {
    report.failure = error.message;
  } finally {
    clearTimeout(timer);
    report.totalMs = Date.now() - began;
    // Interrupt only this ephemeral fixture, never the shared app-server daemon.
    if (report.status === 'timeout' && threadId && turnId) send({ id: ++sequence, method: 'turn/interrupt', params: { threadId, turnId } });
    child.kill();
    if (output) { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
  }
  console.log(JSON.stringify({ success: report.success, label, totalMs: report.totalMs, measurement: report.measurement, failure: report.failure, output, workspace: cwd }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  if (!value('--bin')) throw new Error('--bin is required');
  const report = await benchmark({ bin: value('--bin'), output: value('--output'), workspace: value('--workspace'), label: value('--label'), timeoutMs: Number(value('--timeout-ms') || 360000) });
  if (!report.success) process.exitCode = 1;
}
