#!/usr/bin/env node
// Exercise the real Hook entry, with an indexed-worker protocol fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hook = process.env.ROUTER_UNDER_TEST || path.join(root, 'codex-profile/.codex/hooks/skill-router.mjs');
const home = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'route-specificity-')));
const directory = path.join('/tmp', `codex-graph-${process.getuid()}`);
const graph = path.join(home, 'graph.json');
const socketPath = path.join(directory, `${createHash('sha256').update(graph).digest('hex').slice(0, 24)}.sock`);
const skillPath = path.join(home, 'SKILL.md');
const names = ['engineering-workflow', 'verify-workflow', 'ci-workflow', 'ui-workflow', 'focused-workflow', 'code', 'pdf-workflow'];
const skills = names.map(name => ({ name, path: skillPath, description: 'Generic supporting workflow', source: 'agents' }));
const candidates = ['hnsw-specialist', 'memory-profiler', 'retrieval-load-expert', 'latency-tracer', 'focused-workflow'];
let received = 0;
const server = createServer(socket => {
  let raw = '';
  socket.on('data', chunk => {
    raw += chunk;
    if (!raw.includes('\n')) return;
    received += 1;
    const request = JSON.parse(raw.split('\n')[0]);
    assert.equal(request.top_k, 8);
    socket.end(JSON.stringify({ ok: true, results: candidates.map((name, i) => ({
      name, path: skillPath, kind: name === 'retrieval-load-expert' ? 'expert' : 'skill',
      ...(name === 'retrieval-load-expert' ? { module_id: 'expert:retrieval-load-expert:fixture', package_root: home } : {}),
      description: 'Specific indexed capability', score: 1 / (i + 1), confidence: 'HIGH'
    })) }) + '\n');
  });
});

async function route(prompt) {
  const child = spawn(process.execPath, [hook], { env: { ...process.env, CODEX_HOME: home, CODEX_GRAPH_TOOL_PYTHON: process.execPath } });
  let out = '', err = '';
  child.stdout.on('data', c => { out += c; });
  child.stderr.on('data', c => { err += c; });
  const exited = new Promise(resolve => child.on('close', resolve));
  child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd: root }));
  assert.equal(await exited, 0, err);
  assert.equal(err, '');
  const context = JSON.parse(out).hookSpecificOutput?.additionalContext || '';
  if (context.includes('[Complete expert module;')) {
    assert.match(context, /read the entry above once/);
    assert.match(context, /Do not translate tools or introduce a host mapping/);
    assert.doesNotMatch(context, /Use Codex equivalent agent\/tool APIs/);
  }
  return [...context.matchAll(/^- (.+?) \[/gm)].map(m => m[1]);
}

const cases = [
  ['实现HNSW索引并验证内存开销', candidates],
  ['distinguish CPU time from database queueing', candidates],
  ['Read official scientific acquisition requirements', candidates],
  ['CI and UI checks for this HNSW service', candidates],
  ['不要使用 focused-workflow，调优HNSW索引', candidates],
  ['Do not use $focused-workflow; tune HNSW instead.', candidates],
  ['Do not use skill:focused-workflow; tune HNSW.', candidates],
  ['The log says `use focused-workflow`; tune HNSW.', candidates],
  ['日志里写着“使用 focused-workflow”，请检查索引。', candidates],
  ['Compare focused-workflow with memory-profiler', candidates],
  ['Please use $focused-workflow to inspect the index', ['focused-workflow', ...candidates.slice(0, 4)]],
  ['skill:focused-workflow inspect the index', ['focused-workflow', ...candidates.slice(0, 4)]],
  ['请使用 focused-workflow 调优索引', ['focused-workflow', ...candidates.slice(0, 4)]],
  ['Please use focused-workflow to inspect the index', ['focused-workflow', ...candidates.slice(0, 4)]],
  ['focused-workflow', ['focused-workflow', ...candidates.slice(0, 4)]],
  ['不要用 verify-workflow，使用 focused-workflow', ['focused-workflow', ...candidates.slice(0, 4)]],
  ['Use code blocks to explain HNSW', candidates],
  ['Use the code skill to inspect HNSW', ['code', ...candidates.slice(0, 4)]],
  // Explicit imported resources must not be excluded from the graph results.
  ['$hnsw-specialist explain HNSW', candidates],
  ['Read PDF files and extract their tables', ['pdf-workflow', ...candidates.slice(0, 4)]],
  ['读取PDF账单里的表格，生成指定页的新文件', ['pdf-workflow', ...candidates.slice(0, 4)]],
  ['不要读取PDF文件，调优HNSW', candidates],
  ['The log says "Read PDF files"; tune HNSW', candidates],
  ['Implement a PDF rendering library API', candidates],
  ['Discuss the PDF specification', candidates],
  ['Read the PDF file format library API code', candidates],
  ['Read official scientific acquisition requirements for a pdfium library', candidates],
];

try {
  await mkdir(path.join(home, 'hooks'), { recursive: true });
  await mkdir(path.join(home, 'skill-registry'));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(graph, '{}');
  await writeFile(skillPath, '# Fixture');
  await writeFile(path.join(home, 'hooks/graph_skill_index.py'), '# Fixture');
  await writeFile(path.join(home, 'skill-registry/skills-index.json'), JSON.stringify({ skills, externalGraphPath: graph }));
  await writeFile(path.join(home, 'skill-registry/routing-rules.json'), JSON.stringify({
    _capabilityRoutes: {
      'pdf-workflow': { subjects: ['pdf'], actions: ['read', 'extract', '读取', '生成'],
        objects: ['files', 'tables', '文件', '账单', '表格'], exclude: ['api', 'library', 'specification'] },
      'engineering-workflow': { subjects: 'pdf' }
    },
    'engineering-workflow': ['实现', '架构', 'implement'], 'verify-workflow': ['验证', 'test'],
    'ci-workflow': ['ci'], 'ui-workflow': ['ui']
  }));
  await new Promise(resolve => server.listen(socketPath, resolve));
  const results = await Promise.all(cases.map(async ([prompt, expected]) => {
    const actual = await route(prompt);
    return { prompt, expected, actual, pass: JSON.stringify(expected) === JSON.stringify(actual) };
  }));
  for (const r of results) console.log(JSON.stringify(r));
  assert.equal(received, cases.length, 'every prompt must use the shared graph worker');
  assert.equal(results.filter(r => r.pass).length, cases.length, 'routing contract failures');
  // Exercise fallback independently; topics are still usable without a graph.
  await writeFile(path.join(home, 'skill-registry/skills-index.json'), JSON.stringify({ skills }));
  assert.ok((await route('实现一个新架构')).includes('engineering-workflow'));
  assert.ok((await route('run CI checks')).includes('ci-workflow'));
  assert.ok(!(await route('official acquisition')).includes('ci-workflow'));
  console.log(`PASS: ${cases.length} graph-entry cases and 3 fallback controls`);
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(socketPath, { force: true });
  await rm(home, { recursive: true, force: true });
}
