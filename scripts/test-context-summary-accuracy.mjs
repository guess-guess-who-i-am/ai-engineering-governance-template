#!/usr/bin/env node
// Reproduce the upstream extractor dynamically, with independent factual probes.
// No upstream source is copied into the template; use an external research clone.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const upstream = process.argv[2];
if (!upstream) throw new Error('Provide the external context-mode checkout path');
const code = await readFile(path.join(upstream, 'tests/context-comparison.ts'), 'utf8');
const source = await readFile(path.join(upstream, 'tests/fixtures/test-output.txt'), 'utf8');
const match = code.match(/fixture: "test-output.txt",[\s\S]*?code: `([\s\S]*?)`/);
assert(match, 'upstream extractor not found');
// Interpret escapes as the upstream template literal does, then execute the
// exact snippet in a restricted VM (no require/process or external operations).
const snippet = vm.runInNewContext('`' + match[1] + '`');
const output = [];
const before = performance.now();
vm.runInNewContext(snippet, { FILE_CONTENT: source, console: { log: (...v) => output.push(v.join(' ')) } }, { timeout: 1000 });
const ms = performance.now() - before;
const summary = output.join('\n');
// Ground truth from terminal summary (separate from enumerated fixture rows).
const expected = { suitesPassed: 26, suitesFailed: 4, testsPassed: 108, testsFailed: 4,
  emailFailure: 'Resend API returned 429', userFailure: 'updates user role' };
assert.match(source, /Tests\s+4 failed \| 108 passed/);
assert.match(source, /Test Files\s+4 failed \| 26 passed/);
const probes = [
  ['suitesPassed', /Suites: 26 passed,/.test(summary)],
  ['suitesFailed', /Suites: \d+ passed, 4 failed/.test(summary)],
  ['testsPassed', /Tests: 108 passed,/.test(summary)],
  ['testsFailed', /Tests: \d+ passed, 4 failed/.test(summary)],
  ['emailFailure', summary.includes(expected.emailFailure)],
  ['userFailure', summary.includes(expected.userFailure)],
];
const detailedTests = source.split('\n').filter(l => /^ {2,}[✓✗]/.test(l));
const detailPassed = detailedTests.filter(l => l.trimStart().startsWith('✓')).length;
const detailFailed = detailedTests.length - detailPassed;
const report = { schema: 'context-summary-factual-probes/1', expected, summary, probes, passed: probes.filter(p => p[1]).length, total: probes.length,
  detailCounts: { passed: detailPassed, failed: detailFailed }, fixtureConsistent: detailPassed === expected.testsPassed && detailFailed === expected.testsFailed,
  rawBytes: Buffer.byteLength(source), summaryBytes: Buffer.byteLength(summary), extractorMs: ms,
  decision: 'Do not enable lossy generic compression from byte savings alone',
  limitations: ['six deterministic factual probes on one public fixture; not an LLM task benchmark', 'no measured API token usage'] };
await mkdir('.reports', { recursive: true });
await writeFile('.reports/context-summary-accuracy.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert.equal(report.passed < report.total, true, 'The known upstream information loss must reproduce');
