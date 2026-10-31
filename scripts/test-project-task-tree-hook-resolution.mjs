import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.env.CODEX_NODE || process.execPath;
const fixture = await mkdtemp(path.join(os.tmpdir(), 'codex-task-tree-hook-'));
const kit = path.join(fixture, 'runtime-kit', 'server');
const hook = path.join(repoRoot, '.codex', 'hooks', 'turn-start.mjs');
const stopHook = path.join(repoRoot, '.codex', 'hooks', 'stop-postflight.mjs');

try {
  await mkdir(path.join(fixture, 'llm-task-tree'), { recursive: true });
  await mkdir(kit, { recursive: true });
  await writeFile(path.join(fixture, 'task-tree.md'), '# Fixture tree\n');
  await writeFile(path.join(fixture, 'llm-task-tree', 'task-tree.config.json'), JSON.stringify({ sharedKitDir: 'runtime-kit' }));
  await writeFile(path.join(kit, 'turn-tracker.js'), 'export async function snapshotWorkspace() { return { files: {} }; }\n');
  await writeFile(path.join(kit, 'turn-context.js'), 'export function buildTaskTreeCheckpointContext() { return "fixture-task-tree-context"; }\n');
  await writeFile(path.join(kit, 'execution-scope.js'), 'export function createExecutionScopeStore() { return { get: async () => null }; }\n');
  await writeFile(path.join(kit, 'tree-quality.js'), 'export function parseTreeNodeFields() { return []; }\n');

  const run = spawnSync(node, [hook], {
    cwd: fixture,
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: fixture, session_id: 'fixture', turn_id: 'fixture' }),
    env: { ...process.env, CODEX_HOME: path.join(fixture, 'codex-home') }
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(JSON.parse(run.stdout).hookSpecificOutput.additionalContext.includes('fixture-task-tree-context'));
  assert.ok((await readFile(path.join(fixture, '.task-tree-maintenance', 'turns', 'fixture-fixture.json'), 'utf8')).includes('"schema": "task-tree-turn/v1"'));

  await writeFile(path.join(kit, 'maintenance.js'), `
    export async function repairTurnMaintenance() { return { changedFiles: [], repairs: [] }; }
    export async function auditTurnMaintenance() { return { ok: true, issues: [], warnings: [], repairs: [], checkedAt: 'fixture', activeTree: { id: 'method' }, tree: { path: 'task-tree.md' }, substantiveFiles: [] }; }
  `);
  await writeFile(path.join(kit, 'turn-tracker.js'), `
    export async function snapshotWorkspace() { return { files: {} }; }
    export function diffWorkspaceSnapshots() { return []; }
  `);
  const stop = spawnSync(node, [stopHook], {
    cwd: fixture,
    encoding: 'utf8',
    input: JSON.stringify({ cwd: fixture, session_id: 'fixture', turn_id: 'fixture', stop_hook_active: false }),
    env: { ...process.env, CODEX_HOME: path.join(fixture, 'codex-home') }
  });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stdout.trim(), '{}');
  assert.ok((await readFile(path.join(fixture, '.task-tree-maintenance', 'latest', 'status.json'), 'utf8')).includes('"ok": true'));
  console.log('PASS task-tree UserPromptSubmit and Stop Hooks resolve sharedKitDir from project root.');
} finally {
  await rm(fixture, { recursive: true, force: true });
}
