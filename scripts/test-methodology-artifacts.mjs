#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'methodology-artifacts-'));
const home = path.join(temporary, '用户 home');
const root = path.join(home, '.codex');
const publisher = path.join(root, 'prompt-publisher');
const configFile = path.join(publisher, 'methodology-targets.json');
const refreshMarker = path.join(temporary, 'refresh-called');
try {
  await mkdir(publisher, { recursive: true });
  const config = JSON.parse(await readFile(path.join(repo, 'codex-profile/.codex/prompt-publisher/methodology-targets.json'), 'utf8'));
  for (const name of ['publish-methodology.mjs', 'publish-global-prompt.mjs', 'translation.schema.json', 'methodology-state.json', 'methodology-translation-cache.en.md']) {
    await cp(path.join(repo, 'codex-profile/.codex/prompt-publisher', name), path.join(publisher, name));
  }
  await mkdir(path.join(root, 'prompts'));
  for (const name of new Set(['global-methodology-source.zh.md', ...Object.values(config.outputs).map(file => path.basename(file))])) {
    await cp(path.join(repo, 'codex-profile/.codex/prompts', name), path.join(root, 'prompts', name));
  }
  await mkdir(path.join(root, 'hooks'));
  await cp(path.join(repo, 'codex-profile/mac/hooks/validate-methodology-routing.mjs'), path.join(root, 'hooks/validate-methodology-routing.mjs'));
  await cp(path.join(repo, 'codex-profile/global-skills'), path.join(home, '.agents/skills'), { recursive: true });
  config.validatorFile = '../hooks/validate-methodology-routing.mjs';
  config.refreshRegistryFile = '../hooks/refresh-fixture.mjs';
  for (const route of config.routes) if (route.skillFile) route.skillFile = `../../.agents/skills/${route.id}/SKILL.md`;
  await writeFile(configFile, JSON.stringify(config));
  await writeFile(path.join(root, 'hooks/refresh-fixture.mjs'), `import {writeFile} from 'node:fs/promises'; await writeFile(${JSON.stringify(refreshMarker)}, 'called');`);
  const run = (args = ['--check']) => spawnSync(process.execPath, [path.join(publisher, 'publish-methodology.mjs'), '--config', configFile, '--json', ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: root }, encoding: 'utf8', timeout: 10000
  });
  const checked = run();
  assert.equal(checked.status, 0, checked.stderr);
  const files = [...Object.values(config.outputs).map(file => path.resolve(publisher, file)),
    ...config.routes.filter(route => route.skillFile).map(route => path.resolve(publisher, route.skillFile))];
  for (const file of files) {
    const original = await readFile(file);
    try {
      await writeFile(file, Buffer.concat([original, Buffer.from('\nSTALE GENERATED CONTENT\n')]));
      const stale = run();
      assert.notEqual(stale.status, 0, `--check accepted stale artifact: ${file}`);
      assert.match(stale.stderr, /生成物.*不一致|漂移/, stale.stderr);
    } finally { await writeFile(file, original); }
  }
  const router = path.resolve(publisher, config.outputs.routerEnglish);
  const originalRouter = await readFile(router);
  await rm(router);
  assert.notEqual(run().status, 0, '--check accepted a missing router');
  const repaired = run([]);
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.deepEqual(await readFile(router), originalRouter, 'cached republish did not restore missing router');
  assert.equal(JSON.parse(repaired.stdout).translated, false, 'unchanged source must not trigger a model request');
  await rm(refreshMarker, { force: true });
  assert.equal(run().status, 0);
  assert.equal(await readFile(refreshMarker).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)), null, '--check refreshed the registry');
  const oldLimit = config.contextLimit;
  config.contextLimit = 1;
  await writeFile(configFile, JSON.stringify(config));
  assert.notEqual(run().status, 0, '--check bypassed the context budget');
  config.contextLimit = oldLimit;
  await writeFile(configFile, JSON.stringify(config));
  console.log(`PASS: ${files.length} generated artifacts reject drift; missing router repaired without model; check is read-only and enforces context budget.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
