#!/usr/bin/env node
// Verify bounded category diversity on the already-returned graph candidates.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = await mkdtemp(path.join(os.tmpdir(), 'route-category-budget-'));
const graph = path.join(home, 'graph.json');
const skillPath = path.join(home, 'MODULE.md');
const socketDirectory = path.join('/tmp', `codex-graph-${process.getuid()}`);
let socketPath;
const candidates = [
  ...['expert-a', 'expert-b', 'expert-c'].map((name, i) => ({ name, kind: 'expert', path: skillPath, module_id: `expert:${name}:fixture`, package_root: home, score: 1 - i / 20 })),
  ...['skill-a', 'skill-b', 'skill-c', 'skill-d'].map((name, i) => ({ name, kind: 'skill', path: skillPath, score: .8 - i / 20 })),
  ...['mcp-a', 'mcp-b', 'mcp-c'].map((name, i) => ({ name, kind: 'mcp', mcp_server: 'fixture', score: .6 - i / 20 })),
].map(row => ({ ...row, description: 'fixture candidate', confidence: 'HIGH' }));

await mkdir(path.join(home, 'hooks'), { recursive: true });
await mkdir(path.join(home, 'skill-registry'));
await mkdir(socketDirectory, { recursive: true, mode: 0o700 });
await writeFile(graph, '{}');
socketPath = path.join(socketDirectory, `${createHash('sha256').update(realpathSync(graph)).digest('hex').slice(0, 24)}.sock`);
await writeFile(skillPath, '# Fixture');
await writeFile(path.join(home, 'hooks/graph_skill_index.py'), '# Fixture');
await writeFile(path.join(home, 'skill-registry/skills-index.json'), JSON.stringify({ skills: [], externalGraphPath: graph }));
await writeFile(path.join(home, 'skill-registry/routing-rules.json'), '{}');

const server = createServer(socket => {
  let raw = '';
  socket.on('data', chunk => {
    raw += chunk;
    if (!raw.includes('\n')) return;
    const request = JSON.parse(raw.split('\n')[0]);
    assert.equal(request.top_k, 8, 'category budgeting must not increase graph top_k');
    assert.deepEqual(request.category_slots, { expert: 2, skill: 4, mcp: 2 }, 'GraphToolCall must rank each category into its own fixed slots');
    socket.end(JSON.stringify({ ok: true, results: candidates }) + '\n');
  });
});
await new Promise(resolve => server.listen(socketPath, resolve));

try {
  const child = spawn(process.execPath, [path.join(root, 'codex-profile/.codex/hooks/skill-router.mjs')], {
    env: { ...process.env, CODEX_HOME: home, CODEX_GRAPH_TOOL_PYTHON: process.execPath },
  });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '完成一个综合任务', cwd: root }));
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 0, errors);
  assert.equal(errors, '');
  const context = JSON.parse(output).hookSpecificOutput.additionalContext;
  const rows = [...context.matchAll(/^- (.+?) \[([^;]+);/gm)].map(match => ({ name: match[1], kind: match[2] }));
  assert.equal(rows.length, 8);
  assert.equal(rows.filter(row => row.kind === 'Complete expert module').length, 2);
  assert.equal(rows.filter(row => row.kind === 'Skill').length, 4);
  assert.equal(rows.filter(row => row.kind.startsWith('MCP/')).length, 2);
  assert.deepEqual(rows.map(row => row.name), ['expert-a', 'expert-b', 'skill-a', 'skill-b', 'skill-c', 'skill-d', 'mcp-a', 'mcp-b']);
  console.log(JSON.stringify({ pass: true, topK: 8, selected: rows }));
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(socketPath, { force: true });
  await rm(home, { recursive: true, force: true });
}
