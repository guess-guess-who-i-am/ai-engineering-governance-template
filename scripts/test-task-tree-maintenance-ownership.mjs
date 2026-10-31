import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../llm-task-tree/task-tree.config.json', import.meta.url), 'utf8'));
const runtime = process.env.MAINTENANCE_UNDER_TEST || path.resolve(fileURLToPath(new URL('..', import.meta.url)), config.sharedKitDir, 'server/maintenance.js');
const {auditTurnMaintenance} = await import(pathToFileURL(path.resolve(runtime)).href);
const tree = '# LLM Task Graph\n\n## ROOT - 验证\n- Problem: 如何验证？\n- CurrentResult: 等待验证。\n\n# GraphState\n- Current: ROOT\n- Next: ROOT\n\n# Edges\n';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tree-ownership-'));
  try {
    await writeFile(path.join(root, 'task-tree.md'), tree);
    await mkdir(path.join(root, '.reports'), {recursive: true});
    await writeFile(path.join(root, '.reports/original.role.md'), '# Original role\n' + 'original evidence '.repeat(30));
    return await run(root);
  } finally {await rm(root, {recursive: true, force: true});}
}

test('unchanged role evidence is never checked as a task tree or rewritten', () => fixture(async root => {
  const file = path.join(root, '.reports/original.role.md'), before = await readFile(file);
  const status = await auditTurnMaintenance({projectRoot: root, changedFiles: ['task-tree.md', '.reports/original.role.md', 'scripts/steps/ROOT/latest/report.zh.md']});
  assert.equal(status.ok, true, JSON.stringify(status.issues));
  assert.deepEqual(status.treeQuality.changed.map(r => r.file), ['task-tree.md']);
  assert.ok(status.substantiveFiles.includes('.reports/original.role.md'), 'evidence changes still require maintenance');
  assert.ok(before.equals(await readFile(file)));
}));

test('ordinary Markdown changes still require tree and step evidence', () => fixture(async root => {
  const status = await auditTurnMaintenance({projectRoot: root, changedFiles: ['docs/result.md']});
  assert.ok(status.issues.some(r => r.code === 'TREE_NOT_UPDATED'));
  assert.ok(status.issues.some(r => r.code === 'STEP_EVIDENCE_MISSING'));
}));

test('registered custom paths retain strict tree quality checks', () => fixture(async root => {
  await mkdir(path.join(root, 'docs'));
  await writeFile(path.join(root, 'docs/custom.md'), tree + '\n' + '证据'.repeat(130));
  await writeFile(path.join(root, 'task-trees.json'), JSON.stringify({activeMethod: 'method', trees: [
    {id: 'method', role: 'method', path: 'task-tree.md'}, {id: 'custom', role: 'reference', path: 'docs/custom.md'}
  ]}));
  const status = await auditTurnMaintenance({projectRoot: root, changedFiles: ['docs/custom.md']});
  assert.ok(status.issues.some(r => r.code === 'TREE_LONG_LINES_AFTER_WRITE'));
}));

test('referenced nested subtrees outside the conventional folder retain strict checks', () => fixture(async root => {
  await mkdir(path.join(root, 'chapters'));
  await writeFile(path.join(root, 'task-tree.md'), tree.replace('- Problem:', '- SubtreeFile: chapters/branch.md\n- Problem:'));
  await writeFile(path.join(root, 'chapters/branch.md'), tree + '\n' + '证据'.repeat(130));
  const status = await auditTurnMaintenance({projectRoot: root, changedFiles: ['chapters/branch.md']});
  assert.ok(status.issues.some(r => r.code === 'TREE_LONG_LINES_AFTER_WRITE'));
}));

test('conventional unregistered subtrees retain strict checks', () => fixture(async root => {
  await mkdir(path.join(root, 'subtrees'));
  await writeFile(path.join(root, 'subtrees/branch.md'), tree + '\n' + '证据'.repeat(130));
  const status = await auditTurnMaintenance({projectRoot: root, changedFiles: ['subtrees/branch.md']});
  assert.ok(status.issues.some(r => r.code === 'TREE_LONG_LINES_AFTER_WRITE'));
}));
