#!/usr/bin/env node
// Compare actual Hook outputs against one unchanged resident graph. No model API.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const baseline = process.argv[2] || path.join(home, 'hooks/skill-router.mjs');
const candidate = path.join(root, 'codex-profile/.codex/hooks/skill-router.mjs');
const graph = path.join(home, 'skill-registry/skills.graph.json');
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const before = { graph: await hash(graph), baseline: await hash(baseline), candidate: await hash(candidate) };
assert.notEqual(before.baseline, before.candidate, 'Run before deploying, or supply the previous Hook file');
const challenge = JSON.parse(await readFile(path.join(root, 'scripts/resource-expert-routing-challenge.json'), 'utf8'));
const cases = challenge.cases.flatMap(c => ['zh', 'en'].map(language => ({
  id: c.id, language, prompt: c[language], targets: c.targets
})));
cases.push({ id: 'current-configuration', language: 'zh', targets: ['performance-testing-expert'],
  prompt: '帮我优化当前的全局 Skill、专家和 MCP 路由配置，先分析实际调用链和问题，再实验验证速度、准确率与 token 开销，最后修改并测试。' });

async function run(file, prompt) {
  const startedAt = performance.now();
  const child = spawn(process.execPath, [file], { env: { ...process.env, CODEX_HOME: home } });
  let stdout = '', stderr = '', timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 65000);
  child.stdout.on('data', b => { stdout += b; });
  child.stderr.on('data', b => { stderr += b; });
  child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd: root }));
  const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  clearTimeout(timer);
  const elapsedMs = performance.now() - startedAt;
  assert.equal(code, 0, `Hook failed: ${stderr}`);
  assert.equal(stderr, '', 'A degraded/fallback Hook cannot serve as performance evidence');
  assert.equal(timedOut, false);
  const context = JSON.parse(stdout).hookSpecificOutput?.additionalContext;
  assert.ok(context, 'Hook returned no candidates');
  const candidates = [...context.matchAll(/^- (.+?) \[([^;]+);/gm)].map(m => ({ name: m[1], kind: m[2] }));
  return { elapsedMs, characters: context.length, bytes: Buffer.byteLength(context), candidates, context };
}

const rows = Array(cases.length);
let next = 0;
const batchStarted = performance.now();
const intervals = [];
await Promise.all(Array.from({ length: 4 }, async (_, worker) => {
  while (next < cases.length) {
    const i = next++, c = cases[i], begin = performance.now(), results = {};
    // Alternate ordering; cached graph results remain a declared confounder.
    for (const mode of i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      results[mode] = await run(mode === 'baseline' ? baseline : candidate, c.prompt);
    }
    assert.deepEqual(results.candidate.candidates, results.baseline.candidates, `${c.id}/${c.language}: candidate drift`);
    rows[i] = { id: c.id, language: c.language,
      targetRank: results.candidate.candidates.findIndex(r => c.targets.includes(r.name)) + 1 || null, ...results };
    intervals.push({ worker, case: i, startedMs: begin - batchStarted, endedMs: performance.now() - batchStarted });
  }
}));
assert.equal(await hash(graph), before.graph, 'Graph changed during comparison; reject this run');
assert.equal(await hash(candidate), before.candidate, 'Candidate changed during comparison');
const sums = mode => rows.reduce((acc, r) => ({ characters: acc.characters + r[mode].characters,
  bytes: acc.bytes + r[mode].bytes, elapsedMs: acc.elapsedMs + r[mode].elapsedMs }), { characters: 0, bytes: 0, elapsedMs: 0 });
const old = sums('baseline'), current = sums('candidate');
const summary = { cases: rows.length, unchangedCandidateLists: rows.length,
  challengeTargetHits: rows.slice(0, 14).filter(r => r.targetRank).length,
  baseline: old, candidate: current, characterReductionPercent: 100 * (1 - current.characters / old.characters),
  wallMs: performance.now() - batchStarted, concurrency: 4,
  limitations: ['Name recall is a proxy, not task correctness.', 'No LLM was invoked; total task tokens and expert output quality were not measured.',
    'Character/byte reduction is not a model token count.', 'Resident caches and OS scheduling confound elapsed-time comparisons; no speedup claim.'] };
const report = { before, summary, intervals, rows };
const output = path.join(root, '.reports/router-context-comparison.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, ...summary }, null, 2));
