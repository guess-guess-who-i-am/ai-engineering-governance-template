#!/usr/bin/env node
// Live global boundary check, not an independent retrieval-quality benchmark.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { assessReactUpdaterEvidence } from './resource-docs-evidence.mjs';

const argv = process.argv.slice(2);
const option = (key, fallback) => { const i = argv.indexOf(key); return i < 0 ? fallback : argv[i + 1]; };
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const globalRoot = path.join(os.homedir(), '.codex');
const output = path.resolve(option('--report', path.join(repository, '.reports/resource-integration/global-mcp-e2e.json')));
const routerOnly = argv.includes('--router-only');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { schemaVersion: 'global-resource-mcp-e2e/1', generatedAt: new Date().toISOString(), globalRoot, mode: routerOnly ? 'router-and-entry-only' : 'anonymous-readonly-live', benchmark: false, scope: 'Frozen Chinese prompts in two cwd -> actual global Hook -> exact module -> global entry hash -> anonymous Context7 resolve and query-docs once', tokens: { measured: false, input: null, output: null, reason: 'No model token usage was emitted; bytes are not tokens.' }, routes: [], entries: [], phases: [], business: { ran: false, semanticPassed: false }, errors: [] };
if (option('--replay-report')) {
  const sourcePath = path.resolve(option('--replay-report'));
  assert.notEqual(sourcePath, output, 'Replay output must not replace the original report');
  const sourceBytes = await readFile(sourcePath);
  const original = JSON.parse(sourceBytes);
  const result = original.business?.query?.output?.result;
  assert.ok(result, 'Replay report lacks original query-docs result');
  const text = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
  const assessment = assessReactUpdaterEvidence(text);
  const replay = { schemaVersion: 'global-resource-mcp-replay/1', generatedAt: new Date().toISOString(), mode: 'offline-original-output-reassessment', networkCalls: 0, sourceReport: sourcePath, sourceReportSha256: hash(sourceBytes), sourceReportUnchanged: true, originalPassed: original.passed, originalAssertions: original.business.assertions, queryOutput: original.business.query.output, queryOutputSha256: hash(JSON.stringify(original.business.query.output)), assessment, passed: assessment.passed, limitation: 'Reassesses persisted actual output; does not rerun Hook, network or the expert workflow.' };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(replay, null, 2) + '\n');
  console.log(JSON.stringify({ output, passed: replay.passed, networkCalls: 0, sourceReportSha256: replay.sourceReportSha256, evidence: assessment.evidence }, null, 2));
  if (!replay.passed) process.exitCode = 1;
} else {
async function phase(name, run) {
  const begun = performance.now();
  try { const result = await run(); report.phases.push({ name, ms: Math.round(performance.now() - begun), passed: true }); return result; }
  catch (error) { report.phases.push({ name, ms: Math.round(performance.now() - begun), passed: false, error: error.message }); throw error; }
}
async function globalFile(file) {
  const resolvedRoot = await realpath(globalRoot), resolved = await realpath(file);
  assert.ok(resolved.startsWith(resolvedRoot + path.sep), `Not an actual global entry: ${resolved}`);
  const bytes = await readFile(resolved);
  assert.ok(bytes.length > 0, 'Empty global entry');
  return { path: resolved, bytes: bytes.length, sha256: hash(bytes), text: bytes.toString('utf8') };
}
function hook(prompt, cwd, label) {
  return new Promise(resolve => {
    const begun = performance.now();
    // No test handler, alternate catalog, graph path or explicit Skill name.
    const env = { ...process.env, CODEX_HOME: globalRoot };
    for (const key of ['CODEX_HOOK_DISPATCH_TEST_MODE', 'CODEX_HOOK_DISPATCH_HANDLERS_JSON', 'CODEX_SKILL_INDEX_PATH', 'CODEX_RESOURCE_CATALOG', 'CODEX_SKILL_GRAPH_PATH']) delete env[key];
    const child = spawn(process.execPath, [path.join(globalRoot, 'hooks/hook-dispatch.mjs')], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { stderr += error.message; });
    child.on('close', code => {
      clearTimeout(timer);
      let context = '', parseError;
      try { context = JSON.parse(stdout).hookSpecificOutput?.additionalContext || ''; } catch (error) { parseError = error.message; }
      resolve({ cwd, label, prompt, exitCode: code, timedOut, ms: Math.round(performance.now() - begun), stdout, stderr, parseError, context, contextBytes: Buffer.byteLength(context), contextHash: hash(context), routerPresent: context.includes('[CODEX_SKILL_ROUTER_V2]') });
    });
    child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd, session_id: 'resource-global-e2e-' + randomUUID(), turn_id: '1' }));
  });
}

try {
  const catalog = await phase('read-global-catalog', async () => JSON.parse(await readFile(path.join(globalRoot, 'skill-registry/resource-modules.json'), 'utf8')));
  report.catalogHash = hash(await readFile(path.join(globalRoot, 'skill-registry/resource-modules.json')));
  const frozen = JSON.parse(await readFile(path.join(repository, 'scripts/resource-retrieval-holdout.json'), 'utf8'));
  report.frozenCasesHash = hash(await readFile(path.join(repository, 'scripts/resource-retrieval-holdout.json')));
  const definitions = [
    { caseId: 'parallel-feature-delivery', expected: 'dev-pipeline-orchestrator', kind: 'expert' },
    { caseId: 'trip-budget-feasibility', expected: 'budget-balance', kind: 'skill' },
    { caseId: 'live-library-docs', expected: 'context7', kind: 'mcp-service' }
  ].map(definition => {
    const source = frozen.cases.find(item => item.id === definition.caseId);
    assert.ok(source?.zh, 'Frozen prompt missing');
    const matches = catalog.modules.filter(module => module.name === definition.expected && module.kind === definition.kind);
    assert.equal(matches.length, 1, 'Expected exact unique catalog module');
    return { ...definition, prompt: source.zh, module: matches[0] };
  });
  const cwdRoot = option('--cwdRoot') ? path.resolve(option('--cwdRoot')) : await mkdtemp(path.join(os.tmpdir(), 'resource-global-e2e-'));
  report.cwdRoot = cwdRoot;
  report.cleanup = 'Temporary Hook working directories retained for inspection; no user files removed.';
  const cwds = ['workspace-a', 'workspace-b'].map(name => path.join(cwdRoot, name));
  await Promise.all(cwds.map(cwd => mkdir(cwd, { recursive: true })));
  await phase('global-hooks-two-workspaces', async () => {
    report.routes = await Promise.all(cwds.flatMap(cwd => definitions.map(async definition => {
      const row = await hook(definition.prompt, cwd, definition.caseId);
      const moduleMarker = `Module: ${definition.module.id};`;
      row.expectedModuleId = definition.module.id;
      row.moduleMarkerPresent = row.context.includes(moduleMarker);
      row.entryPathPresent = row.context.includes(`Read: ${definition.module.path}`);
      row.passed = row.exitCode === 0 && !row.timedOut && row.routerPresent && row.moduleMarkerPresent && row.entryPathPresent && !/routing failed|Skill router skipped|timed out/i.test(row.stderr);
      return row;
    })));
    assert.ok(report.routes.every(row => row.passed), 'Actual global Hook failed expected module/path in one or more workspaces');
  });
  await phase('global-entries-and-source-hashes', async () => {
    const expertAudit = JSON.parse(await readFile(path.join(globalRoot, 'resource-evidence/experts-audit.json'), 'utf8'));
    for (const definition of definitions) {
      const entry = await globalFile(definition.module.path);
      const item = { moduleId: definition.module.id, name: definition.expected, kind: definition.kind, path: entry.path, bytes: entry.bytes, sha256: entry.sha256, sourceHashVerified: false, completeWorkflowExecutedHere: false };
      report.entries.push(item);
      if (definition.kind === 'skill') {
        assert.ok(definition.module.entry_hash, 'Skill has no source entry hash');
        assert.equal(entry.sha256, definition.module.entry_hash, 'Installed Skill source hash mismatch');
        item.sourceHashVerified = true; item.expectedHash = definition.module.entry_hash;
      } else if (definition.kind === 'expert') {
        const primary = entry.text.match(/^Original primary role:\s*(.+)$/m)?.[1]?.trim();
        assert.ok(primary, 'Complete expert adapter lacks Original primary role');
        const role = await globalFile(primary);
        assert.ok(role.path.startsWith((await realpath(definition.module.package_root)) + path.sep), 'Primary role outside module package');
        const relative = path.relative(definition.module.package_root, primary).split(path.sep).join('/');
        const record = expertAudit.records.find(record => record.name === definition.expected);
        const expectedHash = record?.hashes?.[relative];
        assert.ok(expectedHash, 'No audited source role hash');
        assert.equal(role.sha256, expectedHash, 'Original expert role changed');
        assert.ok(Buffer.from(entry.text).subarray(-Buffer.from(role.text).length).equals(Buffer.from(role.text)),
          'One-read entry must contain the original role verbatim');
        item.primaryRole = { path: role.path, bytes: role.bytes, sha256: role.sha256, expectedHash, sourceHashVerified: true };
        item.sourceHashVerified = true;
      } else item.generatedDescriptorOnly = true;
    }
  });
  if (!routerOnly) await phase('global-cli-anonymous-context7-business', async () => {
    const cliPath = path.join(globalRoot, 'tools/resource-modules/resource-mcp-cli.mjs');
    const cliEntry = await globalFile(cliPath);
    report.cli = { path: cliEntry.path, bytes: cliEntry.bytes, sha256: cliEntry.sha256 };
    const { runResourceMcpCli } = await import(pathToFileURL(cliPath).href);
    const module = definitions.find(item => item.expected === 'context7').module;
    report.business = { ran: true, moduleId: module.id, anonymous: true, readOnly: true, credentialsUsed: false, modelCalled: false, semanticPassed: false };
    const resolve = await runResourceMcpCli(['call', module.id, '--tool', 'resolve-library-id', '--arguments', JSON.stringify({ libraryName: 'react', query: 'React useState official documentation with functional updater previous state example' })]);
    report.business.resolve = { output: resolve, outputSha256: hash(JSON.stringify(resolve)), phaseMs: resolve.trace?.reduce((n, row) => n + row.ms, 0) };
    assert.equal(resolve.protocolSucceeded, true, 'resolve returned an MCP error');
    const content = (resolve.result?.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
    const candidates = [...content.matchAll(/(?:Context7-compatible library ID|Library ID):\s*(\/[^\s`]+)/gi)].map(match => match[1]);
    const libraryId = candidates.find(id => /reactjs\/react\.dev|websites\/react_dev|react\/react/.test(id));
    assert.ok(libraryId, 'No actual React library ID in resolve output');
    report.business.resolvedLibraryId = libraryId;
    const query = await runResourceMcpCli(['call', module.id, '--tool', 'query-docs', '--arguments', JSON.stringify({ libraryId, query: 'How do I declare a React useState counter and update it from previous state with a functional updater? Show official code examples.' })]);
    report.business.query = { output: query, outputSha256: hash(JSON.stringify(query)), phaseMs: query.trace?.reduce((n, row) => n + row.ms, 0) };
    assert.equal(query.protocolSucceeded, true, 'query-docs returned an MCP error');
    const text = (query.result?.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
    const assessment = assessReactUpdaterEvidence(text);
    const assertions = assessment.assertions;
    report.business.assertions = assertions;
    report.business.assessment = assessment;
    assert.ok(assessment.passed, 'Actual Context7 output failed task-specific semantic assertions');
    report.business.semanticPassed = true;
    report.business.limitation = 'One anonymous readonly documentation task, not independent accuracy benchmark, specified-version correctness proof, or expert workflow re-execution.';
  });
  report.passed = report.routes.every(row => row.passed) && report.entries.length === 3 && (routerOnly || report.business.semanticPassed);
} catch (error) { report.passed = false; report.errors.push({ message: error.message, stack: error.stack }); }
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, passed: report.passed, mode: report.mode, routes: report.routes.map(row => ({ label: row.label, cwd: row.cwd, passed: row.passed, ms: row.ms, contextBytes: row.contextBytes })), entries: report.entries.map(row => ({ name: row.name, sourceHashVerified: row.sourceHashVerified, generatedDescriptorOnly: row.generatedDescriptorOnly })), business: { ran: report.business.ran, semanticPassed: report.business.semanticPassed }, errors: report.errors.map(error => error.message) }, null, 2));
if (!report.passed) process.exitCode = 1;
}
