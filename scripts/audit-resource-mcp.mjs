#!/usr/bin/env node
// Read metadata only: never load source MCP configuration values or credentials.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMcpHttpClient } from './resource-mcp-runtime.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const root = option('--source', '/Users/pku1727/Desktop/破解workbuddy/统一资源库');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = option('--output', path.join(repo, '.reports/resource-integration/mcp-audit.json'));
const live = args.includes('--probe');
const timeoutMs = 15000, concurrency = 12;
const source = JSON.parse(await readFile(path.join(root, '审计/mcp.json'), 'utf8'));
const sha = text => createHash('sha256').update(text).digest('hex');
const count = values => Object.fromEntries([...new Set(values)].sort().map(k => [k, values.filter(x => x === k).length]));
const credentialKeys = keys => keys.some(k => /authorization|api.?key|token|password|secret|credential/i.test(k));
const safeText = value => String(value || '').replace(/(?:https?:\/\/)[^\s)"<>\\]+/g, raw => { try { const u = new URL(raw); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.toString(); } catch { return '[invalid-url]'; } }).replace(/\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]');
function endpoint(value) {
  try { const u = new URL(value); if (u.username || u.password || u.search || /\$\{|\{\{|<|>/u.test(value)) return { eligible: false, display: u.origin, reason: 'URL contains credentials, query, or placeholders' }; return { eligible: u.protocol === 'https:', display: u.origin + u.pathname }; }
  catch { return { eligible: false, display: '', reason: 'missing or invalid endpoint' }; }
}
async function manifestFor(file) {
  let dir = path.dirname(file);
  for (let depth = 0; depth < 5; depth++, dir = path.dirname(dir)) {
    for (const rel of ['.codebuddy-plugin/plugin.json', '.workbuddy-plugin/plugin.json']) {
      try { const m = JSON.parse(await readFile(path.join(dir, rel), 'utf8')); return { name: safeText(m.name), description: safeText(m.description), license: m.license || 'unknown' }; } catch {}
    }
  }
  return { name: '', description: '', license: 'unknown' };
}
async function pool(items, fn) {
  let cursor = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (cursor < items.length) { const i = cursor++; results[i] = await fn(items[i], i); } }));
  return results;
}
async function session(url) {
  const client = createMcpHttpClient(url, { timeoutMs });
  return { trace: client.trace, initialize: client.initialize, list: client.listTools, call: client.callTool };
}

const started = performance.now();
const previous = args.includes('--trials-only') ? JSON.parse(await readFile(output, 'utf8')) : null;
const records = previous?.records || await pool(source, async row => {
  const manifest = await manifestFor(row.path);
  const ep = endpoint(row.url);
  const auth = credentialKeys([...(row.header_keys || []), ...(row.env_keys || [])]);
  const hostBound = /\$\{(?:CODEBUDDY|WORKBUDDY)|WORKBUDDY|CODEBUDDY|cmd\.exe|[A-Z]:\\/.test([row.command, ...(row.args || []), ...(row.env_keys || [])].join(' '));
  const descriptor = { schemaVersion: 1, id: `resource-mcp:${row.config_hash}`, kind: 'mcp_server', name: row.name, aliases: row.aliases || [], sourceRef: row.unified_path, sourceConfigHash: row.config_hash, manifest, transport: row.transport, endpoint: ep.display, commandName: path.basename(row.command || ''), envKeys: row.env_keys || [], headerKeys: row.header_keys || [], placeholders: row.placeholders || [], auth: auth ? 'declared-credential-binding' : 'not-declared-not-proof-of-anonymous-access', cost: 'unknown', runtimePresentFromPriorAudit: row.runtime_present === true, hostBound, priorProbe: row.probe || null, sourceDescription: manifest.description, graphDescription: `${row.name}. ${manifest.description}`, eligibility: 'catalog-only', toolDiscovery: { state: 'not-run' } };
  if (live && row.transport === 'http' && ep.eligible && !auth && !row.placeholders?.length && row.probe?.protocol_version) {
    const s = await session(row.url);
    try {
      descriptor.initialization = await s.initialize();
      const tools = await s.list();
      descriptor.tools = tools.map(t => ({ name: t.name, description: safeText(t.description), inputSchema: t.inputSchema, annotations: t.annotations }));
      descriptor.toolDiscovery = { state: 'passed', count: tools.length, trace: s.trace };
      descriptor.eligibility = tools.length ? 'tool-catalog-only-business-and-cost-unverified' : 'no-tools';
    } catch (error) { descriptor.toolDiscovery = { state: 'failed', error: safeText(error.message), trace: s.trace }; }
  }
  return descriptor;
});

const trials = previous?.trials || [];
// Explicit allowlist: anonymous, read-only public code/documentation queries; no user data or credentials.
if (live) for (const trial of [
  { server: 'grep_app', tool: 'searchGitHub', args: { query: 'useState(' }, expected: 'Public GitHub code results containing literal useState call, repository and file path', assert: s => /Repository:/.test(s) && /Path:/.test(s) && /useState\(/.test(s) },
  { server: 'context7', tool: 'resolve-library-id', args: { libraryName: 'react', query: 'React useState hook official documentation' }, expected: 'React documentation library IDs', assert: s => /react/i.test(s) && /library ID|\/websites\/|\/facebook\/react/i.test(s) },
  { server: 'context7', tool: 'query-docs', args: { libraryId: '/reactjs/react.dev', query: 'How to declare a counter with useState and update it from the previous value using a functional updater?' }, expected: 'Documentation containing useState initialization and updater example', assert: s => /useState/.test(s) && /setCount|setCounter|updater|previous state/i.test(s) }
].filter(trial => !option('--server') || trial.server === option('--server'))) {
  const row = source.find(r => r.name === trial.server);
  const sessionClient = await session(row.url);
  const item = { server: trial.server, tool: trial.tool, arguments: trial.args, expected: trial.expected, credentialsUsed: false, readOnly: true, costEvidence: 'Anonymous public endpoint; no paid account, API key or billed workspace used. Future pricing/quota not guaranteed.' };
  try {
    await sessionClient.initialize();
    const tools = await sessionClient.list();
    if (!tools.find(t => t.name === trial.tool)) throw new Error('Expected tool absent');
    const result = await sessionClient.call(trial.tool, trial.args);
    const serialized = JSON.stringify(result);
    item.resultIsError = result.isError === true;
    item.semanticAssertion = trial.assert(serialized);
    item.passed = !item.resultIsError && item.semanticAssertion;
    item.resultBytes = Buffer.byteLength(serialized);
    item.resultHash = sha(serialized);
    item.excerpt = safeText(serialized).slice(0, 1800);
  } catch (error) { item.passed = false; item.error = safeText(error.message); }
  item.trace = sessionClient.trace;
  trials.push(item);
}

const descriptions = count(records.map(r => r.sourceDescription || '<missing>'));
for (const r of records) {
  r.descriptionQuality = !r.sourceDescription ? 'missing' : descriptions[r.sourceDescription] > 1 ? 'shared-plugin-description-not-server-specific' : /[\u4e00-\u9fff]/.test(r.sourceDescription) ? 'has-chinese-text-needs-query-test' : 'english-only-needs-chinese-query-test';
  const aliases = { context7: '开发文档 官方文档 第三方库 API 用法 示例 最新版本文档 React Python JavaScript', grep_app: 'GitHub 开源代码搜索 真实代码示例 literal pattern 正则检索 仓库文件 搜索代码用法' };
  r.retrievalAliases = aliases[r.name] || '';
  const toolSummary = (r.tools || []).slice(0, 12).map(t => `${t.name}: ${(t.description || '').slice(0, 180)}`).join('; ');
  r.graphDescription = [r.name, ...(r.aliases || []), r.descriptionQuality === 'shared-plugin-description-not-server-specific' && toolSummary ? '' : r.sourceDescription, r.retrievalAliases, toolSummary].filter(Boolean).join(' ');
  if (trials.some(t => t.server === r.name && t.passed)) r.eligibility = 'readonly-sample-passed';
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), mode: live ? 'live-readonly' : 'static', priorDiscoveryPreserved: previous?.generatedAt, scope: '478 audited MCP connection definitions, not proof of 478 usable services', policy: { concurrency, timeoutMs, sourceConfigsRead: false, credentialValuesLoadedFromSourceConfigs: false, credentialsUsed: false, arbitraryBusinessToolsRun: false }, elapsedMs: Math.round(performance.now() - started), summary: { total: records.length, transports: count(records.map(x => x.transport)), descriptionQuality: count(records.map(x => x.descriptionQuality)), manifestLicenses: count(records.map(x => x.manifest.license)), hostBound: records.filter(x => x.hostBound).length, credentialBindings: records.filter(x => x.auth === 'declared-credential-binding').length, discovery: count(records.map(x => x.toolDiscovery.state)), discoveredTools: records.reduce((n, x) => n + (x.tools?.length || 0), 0), trialsPassed: trials.filter(x => x.passed).length, trialsRun: trials.length }, records, trials, integration: { serverNodes: 'Index all definitions as catalog candidates with explicit readiness status, never as automatically executable tools.', toolNodes: 'Index only tools/list schemas with server relation; preserve original descriptions and inputSchema. Add bilingual retrieval aliases separately, do not rewrite tool semantics.', requiresEdges: ['tool -> mcp_server', 'mcp_server -> credential_binding', 'mcp_server -> runtime', 'expert_module -> required_tool'], execution: 'Route -> readiness/auth/cost check -> connect once per session -> tool selection -> validate arguments -> call. Unknown cost stays blocked for business calls, including discovered anonymous services.', sessionReuse: 'Pool live clients per server/auth/transport identity; do not share session IDs across different principals or assume server supports concurrent calls.' } };
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, ...report.summary, elapsedMs: report.elapsedMs, trials: trials.map(x => ({ server: x.server, tool: x.tool, passed: x.passed, error: x.error, trace: x.trace })) }, null, 2));
