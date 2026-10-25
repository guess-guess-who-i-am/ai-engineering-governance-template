import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildOperations, applyTransaction, hooksDocument, mergeHooks } from './install-codex-profile-mac.mjs';
import { resourcePlan, serviceDocument } from './global-profile-service.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'portable-profile-'));
try {
  const home = path.join(directory, '用户 with spaces');
  const root = path.join(home, '.codex');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'config.toml'), 'model = "keep-my-model"\n[model_providers.custom]\nname = "keep"\n');
  const foreign = { command: 'custom-hook', type: 'command' };
  await writeFile(path.join(root, 'hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [foreign] }], Stop: [{ hooks: [foreign] }] } }));
  await writeFile(path.join(root, 'AGENTS.md'), '用户自有规则保留\n');
  const library = path.join(directory, 'external');
  await mkdir(library);
  await writeFile(path.join(library, '_catalog_cn.json'), '{"skills":[]}');
  process.env.CODEX_PROFILE_SKILL_SOURCE = library;
  const plan = await buildOperations(home);
  const changes = [];
  for (const operation of plan.operations) {
    let original = null;
    try { original = await readFile(operation.destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!original?.equals(operation.content)) changes.push({ ...operation, original });
  }
  const applied = await applyTransaction(root, changes);
  assert.ok(applied.backupDirectory);
  const config = await readFile(path.join(root, 'config.toml'), 'utf8');
  assert.ok(config.includes('model = "keep-my-model"'));
  assert.ok(config.includes('max_concurrent_threads_per_session = 20'));
  const hooks = JSON.parse(await readFile(path.join(root, 'hooks.json'), 'utf8'));
  assert.deepEqual(hooks.hooks.UserPromptSubmit[0].hooks, [foreign]);
  assert.deepEqual(hooks.hooks.Stop[0].hooks, [foreign]);
  const managed = hooksDocument(root);
  assert.deepEqual(mergeHooks(hooks, managed, root), hooks, 'hook merge must be idempotent and keep indices');
  const checked = await buildOperations(home);
  for (const item of checked.operations) assert.deepEqual(await readFile(item.destination), item.content, 'drift: ' + item.destination);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: root, CODEX_SKIP_EXTERNAL_INDEX_REFRESH: '1' };
  const publisher = spawnSync(process.execPath, [path.join(root, 'prompt-publisher/publish-methodology.mjs'), '--config', path.join(root, 'prompt-publisher/methodology-targets.json'), '--check', '--json'], { env, encoding: 'utf8' });
  assert.equal(publisher.status, 0, publisher.stderr + publisher.stdout);
  const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'test parallel tools', cwd: directory, session_id: 'portable' });
  const handler = spawnSync(process.execPath, [path.join(root, 'hooks/hook-dispatch.mjs')], { env, input, encoding: 'utf8' });
  assert.equal(handler.status, 0, handler.stderr);
  assert.ok(handler.stdout.includes('ADAPTIVE_TOOL_SCHEDULING_CONTRACT_V5'));
  assert.equal(resourcePlan({ cpus: 64, memory: 128 * 1024 ** 3 }).processes, 8);
  assert.equal(resourcePlan({ cpus: 2, memory: 4 * 1024 ** 3 }).processes, 1);
  assert.equal(resourcePlan({ cpus: 2, memory: 128 * 1024 ** 3 }).processes, 2);
  for (const platform of ['darwin', 'linux', 'win32']) {
    const spec = serviceDocument({ platform, home, resources: { processes: 8, memoryHigh: 22, memoryMax: 24 } });
    assert.ok(spec.text.includes('graph-worker-supervisor.mjs'));
    if (platform === 'linux') assert.ok(spec.text.includes('MemoryHigh=22G\nMemoryMax=24G'));
    if (platform === 'win32') assert.ok(spec.text.includes('LogonTrigger') && spec.text.includes('PT0S'));
    if (platform === 'darwin') assert.ok(spec.text.includes('KeepAlive') && spec.text.includes('RunAtLoad'));
  }
  const windowsCommand = hooksDocument(root, 'win32', 'C:\\Program Files\\nodejs\\node.exe').hooks.UserPromptSubmit[0].hooks[0].command;
  assert.ok(windowsCommand.startsWith('"C:\\Program Files\\nodejs\\node.exe"'));
  console.log('PASS portable profile: 22 global Skills, 76-rule publisher, V5 Hook, native paths/quoting, custom hook/model preservation, backups, repeat-install zero drift, resource-aware startup documents.');
} finally { await rm(directory, { recursive: true, force: true }); }
