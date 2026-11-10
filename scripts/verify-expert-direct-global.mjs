#!/usr/bin/env node
// Production read-only check: routing -> one entry read -> exact original bytes.
// Does not start an LLM turn, execute expert instructions, or call external APIs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExpertEntry, refreshExpertEntries } from './expert-entry.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hashOption = process.argv.indexOf('--router-sha256');
const expectedRouterHash = hashOption < 0 ? undefined : process.argv[hashOption + 1];
if (hashOption >= 0 && !/^[a-f0-9]{64}$/.test(expectedRouterHash || '')) throw new Error('Invalid --router-sha256');
const codex = path.join(os.homedir(), '.codex');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const graphFile = path.join(codex, 'skill-registry/skills.graph.json');
const catalogFile = path.join(codex, 'skill-registry/resource-modules.json');
const node = process.execPath;
const graphBefore = sha(await readFile(graphFile)), catalogBefore = await readFile(catalogFile);
const catalog = JSON.parse(catalogBefore);
const temp = await mkdtemp(path.join(os.tmpdir(), 'expert-global-workspaces-'));
const report = { schemaVersion: 'expert-direct-global-verification/1', hookNode: node, graphSha256: graphBefore,
  scope: 'Actual global router and one-read original-role loading; not expert business execution or an IDE model turn',
  routes: [], passed: false };

function hook(prompt, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [path.join(codex, 'hooks/skill-router.mjs')], { cwd, env: process.env });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Global Hook timeout')); }, 60000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || stderr) return reject(new Error('Global Hook failed; no execution claimed'));
      try { resolve(JSON.parse(stdout).hookSpecificOutput?.additionalContext || ''); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd }));
  });
}

try {
  assert.equal(sha(await readFile(path.join(codex, 'hooks/skill-router.mjs'))),
    expectedRouterHash || sha(await readFile(path.join(repo, 'codex-profile/.codex/hooks/skill-router.mjs'))));
  const check = await refreshExpertEntries({ codexRoot: codex });
  assert.equal(check.changed, 0, 'every generated entry must match the current original role');
  report.entries = { experts: check.experts, ready: check.ready, blocked: check.blocked, stale: check.changed };
  const cases = [
    ['dev-pipeline-orchestrator', 'Use dev-pipeline-orchestrator to take a feature from idea to delivery with focused subagents, test-driven tasks, spec review and quality review.'],
    ['performance-testing-expert', 'Use performance-testing-expert to establish a baseline, design load scenarios, find bottlenecks and verify performance improvements.']
  ];
  report.routes = await Promise.all(cases.map(async ([name, prompt], index) => {
    const cwd = path.join(temp, 'workspace-' + index); await mkdir(cwd);
    const started = performance.now();
    const context = await hook(prompt, cwd);
    assert.match(context, /For a selected expert, read its entry once/);
    const experts = context.split('\n- ').filter(block => block.includes('[Complete expert module;'));
    const match = experts.find(block => block.startsWith(name + ' ['));
    assert.ok(match, 'Expected complete expert was not routed: ' + name);
    assert.doesNotMatch(match, /Use Codex equivalent agent\/tool APIs/);
    const moduleId = match.match(/\n  Module: (.+?); package:/)?.[1];
    const entryPath = match.match(/\n  Read: (.+)/)?.[1];
    const module = catalog.modules.find(module => module.id === moduleId && module.kind === 'expert');
    assert.ok(module); assert.equal(entryPath, module.path);
    const entry = await readFile(entryPath), expected = await buildExpertEntry(module);
    assert.ok(entry.equals(expected.bytes));
    return { name, moduleId, workspace: cwd, originalRoleLoadedVerbatim: true,
      originalBytes: expected.originalBytes, primarySha256: expected.primarySha256,
      hookAndEntryMs: performance.now() - started, expertWorkflowExecuted: false };
  }));
  assert.equal(sha(await readFile(graphFile)), graphBefore);
  assert.ok((await readFile(catalogFile)).equals(catalogBefore));
  report.graphAndCatalogUnchanged = true; report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  await mkdir(path.join(repo, '.reports'), { recursive: true });
  await writeFile(path.join(repo, '.reports/expert-direct-global-verification.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(temp, { recursive: true, force: true });
  console.log(JSON.stringify(report));
}
