#!/usr/bin/env node
// Read-only production snapshot; probes run in a separate scratch runtime.
// Does not invoke SessionStart/Stop, modify IDE files, or restart any worker.
import { createHash } from 'node:crypto';
import { readFile, stat, mkdtemp, writeFile, realpath } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const options = Object.fromEntries(process.argv.slice(2).map((arg, index, args) => arg.startsWith('--') ? [arg.slice(2), args[index + 1]] : []).filter(pair => pair.length));
const home = options['codex-home'] || path.join(os.homedir(), '.codex');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const fileVersion = async file => {
  const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
  return { path: file, sha256: sha(bytes), bytes: info.size, modifiedAt: info.mtime.toISOString() };
};
function rpc(socketPath) {
  const socket = net.createConnection(socketPath);
  let buffer = '', next = 0;
  const pending = new Map();
  const fail = error => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); };
  socket.setEncoding('utf8');
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('socket closed')));
  socket.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const response = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      const entry = pending.get(response.id); if (!entry) continue;
      pending.delete(response.id); clearTimeout(entry.timer);
      response.error ? entry.reject(new Error(response.error)) : entry.resolve(response.result);
    }
  });
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('audit RPC timeout')); socket.destroy(); }, 65000);
        pending.set(id, { resolve, reject, timer });
        socket.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    close() { socket.end(); }
  };
}
async function graphQuery(socketPath, query) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let buffer = '';
    socket.setEncoding('utf8'); socket.setTimeout(55000);
    socket.on('error', reject); socket.on('timeout', () => socket.destroy(new Error('graph timeout')));
    socket.on('close', () => { if (!buffer.includes('\n')) reject(new Error('graph closed without response')); });
    socket.on('connect', () => socket.write(JSON.stringify({ query, top_k: 8, deadline: Date.now() + 55000 }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      socket.end(); const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
      resolve({ ...response, durationMs: Math.round(performance.now() - start) });
    });
  });
}
const registry = await json(path.join(home, 'skill-registry/skills-index.json'));
const manifest = await json(path.join(home, 'skill-registry/skills.graph.manifest.json'));
const graphPath = registry.externalGraphPath;
const graphSocket = path.join('/tmp', `codex-graph-${process.getuid()}`, `${sha(graphPath).slice(0, 24)}.sock`);
const runtimeSocket = options['runtime-socket'];
if (!runtimeSocket) throw new Error('--runtime-socket must identify the already-running broker; audit never starts it');
const statusClient = rpc(runtimeSocket);
const brokerBefore = await statusClient.call('status'); statusClient.close();
const report = {
  measuredAt: new Date().toISOString(),
  versions: await Promise.all(['hooks/graph_skill_index.py', 'hooks/skill-router.mjs', 'hooks/hook-dispatch.mjs', 'hooks.json'].map(file => fileVersion(path.join(home, file)))),
  graph: { socket: graphSocket, path: graphPath, manifest, registryEntries: registry.skills.length },
  brokerBefore
};
if (options.url && options['run-id']) {
  const response = await fetch(new URL('/api/codex/runs', options.url), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`IDE snapshot HTTP ${response.status}`);
  const run = (await response.json()).runs.find(run => run.id === options['run-id']);
  if (!run) throw new Error('target run not found');
  const events = run.events || [], tools = events.filter(event => event.type === 'tool/completed');
  report.production = {
    id: run.id, status: run.status, rounds: run.timing?.rounds?.length,
    recentRounds: run.timing?.rounds?.slice(-5).map(({ round, requestMs, totalMs, requestBytes, toolCalls }) => ({ round, requestMs, totalMs, requestBytes, toolCalls })),
    runtime: events.filter(event => event.type === 'runtime/ready').map(({ at, worker, runtimeMs, indexFile }) => ({ at, worker, runtimeMs, indexFile })),
    initialHooks: events.filter(event => ['SessionStart', 'UserPromptSubmit'].includes(event.hookEvent)).map(event => ({
      at: event.at, event: event.hookEvent, blocked: event.blocked,
      reports: event.reports?.map(({ source, event, ok, durationMs, contextSha256, stderr }) => ({ source, event, ok, durationMs, contextSha256, hasWarning: !!stderr }))
    })),
    completedTools: tools.length,
    toolHookTotals: { preMs: tools.reduce((sum, event) => sum + (event.timing?.preHookMs || 0), 0), postMs: tools.reduce((sum, event) => sum + (event.timing?.postHookMs || 0), 0) }
  };
}
const query = 'postgresql database performance query index optimization audit 20261018';
const first = await graphQuery(graphSocket, query);
const second = await graphQuery(graphSocket, query);
const parallelStart = performance.now();
const parallel = await Promise.all([0, 1, 2, 3].map(number => graphQuery(graphSocket, `${query} candidate ${number}`)));
const summarize = ({ ok, pid, queryPid, loads, prefilter, metrics, durationMs, error }) => ({ ok, pid, queryPid, loads, prefilter, metrics, durationMs, error });
report.retrieval = { first: summarize(first), repeated: summarize(second), parallelWallMs: Math.round(performance.now() - parallelStart), parallel: parallel.map(summarize) };
const scratch = options.scratch ? await realpath(options.scratch) : await mkdtemp(path.join(os.tmpdir(), 'global-routing-audit-'));
if (path.dirname(scratch) !== await realpath(os.tmpdir()) || !path.basename(scratch).startsWith('global-routing-audit-')) throw new Error('scratch must be an audit-specific temporary directory');
report.scratch = scratch;
const clients = [rpc(runtimeSocket), rpc(runtimeSocket)];
try {
  const started = performance.now();
  const runtimes = await Promise.all(clients.map(client => client.call('open', { cwd: scratch, codexHome: home, environment: { CODEX_HOME: home } })));
  const mcpCatalog = await json(path.join(home, 'skill-registry/mcp-tools.json'));
  const exposedTools = new Set(runtimes[0].tools.map(tool => tool.function.name));
  report.runtimeProbes = {
    openWallMs: Math.round(performance.now() - started),
    runtimes: runtimes.map(({ worker, skillCount, indexFile, hookSources }) => ({ worker, skillCount, indexFile, hookSources })),
    toolCoverage: mcpCatalog.tools.map(({ name, server }) => ({ name, server, nameExposed: exposedTools.has(name) }))
  };
  const hookStart = performance.now();
  const hooks = await Promise.all(clients.map((client, number) => client.call('hooks', { event: 'UserPromptSubmit', input: { prompt: query, session_id: `audit-${process.pid}-${number}`, turn_id: '1' } })));
  report.runtimeProbes.hookWallMs = Math.round(performance.now() - hookStart);
  report.runtimeProbes.hooks = hooks.map(result => ({
    blocked: result.blocked, routed: result.context.includes('[CODEX_SKILL_ROUTER_V2]'),
    contextBytes: Buffer.byteLength(result.context),
    reports: result.reports.map(({ source, event, ok, durationMs, stderr }) => ({ source, event, ok, durationMs, hasWarning: !!stderr })),
    routedPaths: [...result.context.matchAll(/^\s+Read: (.+)$/gm)].map(match => match[1])
  }));
  const external = report.runtimeProbes.hooks[0].routedPaths.find(file => file.startsWith(path.join(home, 'tools/skills') + path.sep)) || first.results?.find(item => item.path?.startsWith(path.join(home, 'tools/skills') + path.sep))?.path;
  if (external) {
    report.runtimeProbes.externalRead = { path: external, wasHookCandidate: report.runtimeProbes.hooks[0].routedPaths.includes(external) };
    try {
      const result = await clients[0].call('call', { name: 'skills_read', args: { name: external } });
      report.runtimeProbes.externalRead.ok = !!result.content;
      report.runtimeProbes.externalRead.bytes = Buffer.byteLength(result.content || '');
    } catch (error) { report.runtimeProbes.externalRead.ok = false; report.runtimeProbes.externalRead.error = error.message; }
    const fallback = await clients[0].call('call', { name: 'read_file', args: { path: external } });
    report.runtimeProbes.externalRead.directFileReadOk = !!fallback.content;
    report.runtimeProbes.externalRead.directFileReadBytes = Buffer.byteLength(fallback.content || '');
  }
} finally { clients.forEach(client => client.close()); }
console.log(JSON.stringify(report, null, 2));
if (options.output) await writeFile(path.resolve(options.output), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
