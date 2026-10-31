#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildExpertEntry, refreshExpertEntries } from './expert-entry.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function put(root, relative, bytes) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
  return file;
}
async function fixture(t, manifest = { agentName: 'lead', agents: ['agents/reviewer.md', 'agents/lead.md'] }) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'expert-direct-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = path.join(home, 'resource-packages/expert/team');
  const original = Buffer.from('\ufeff---\r\nname: lead\r\ntools: [OriginalTool]\r\n---\r\n# Original role\r\nUse skills/check/SKILL.md then ask reviewer. 中文原文。\r\n');
  await put(root, '.codebuddy-plugin/plugin.json', JSON.stringify(manifest));
  await put(root, 'agents/lead.md', original);
  await put(root, 'agents/reviewer.md', '# Reviewer — must not become lead\n');
  await put(root, 'skills/check/SKILL.md', '# Original internal Skill\n');
  const module = { id: 'expert:team:fixture', name: 'team', kind: 'expert', package_root: root,
    path: path.join(home, 'resource-adapters/fixture/MODULE.md') };
  await put(home, 'resource-adapters/fixture/MODULE.md', '# Old external entry\nMap original TeamCreate to collaboration.spawn_agent\n');
  await put(home, 'skill-registry/resource-modules.json', JSON.stringify({ modules: [module] }));
  return { home, root, module, original };
}

test('one read includes the whole declared lead, byte-for-byte, without mapping or member expansion', async t => {
  const f = await fixture(t), entry = await buildExpertEntry(f.module);
  assert.ok(entry.bytes.subarray(-f.original.length).equals(f.original));
  assert.equal(entry.primarySha256, hash(f.original));
  assert.match(entry.bytes.toString(), /EXPERT_ENTRY_V1: ORIGINAL_ROLE_LOADED/);
  assert.match(entry.bytes.toString(), /Loading is not completion/);
  assert.doesNotMatch(entry.bytes.toString(), /must not become lead|collaboration\.spawn_agent|Map original TeamCreate/);
  assert.ok((await readFile(path.join(f.root, 'agents/lead.md'))).equals(f.original));
});

test('primary resolution supports teamInfo, directory declaration and a sole role', async t => {
  for (const manifest of [
    { teamInfo: { leadAgent: 'lead' }, agents: 'agents' },
    { agentName: 'agents/lead.md', agents: ['agents/reviewer.md', 'agents/lead.md'] },
    { agentName: './agents/lead.md', agents: ['agents/reviewer.md', 'agents/lead.md'] },
    { agentName: 'lead.md', agents: ['agents/reviewer.md', 'agents/lead.md'] },
    { agents: ['agents/lead.md'] },
    { agents: 'agents/lead.md' }
  ]) {
    const f = await fixture(t, manifest);
    assert.ok((await buildExpertEntry(f.module)).bytes.subarray(-f.original.length).equals(f.original));
  }
});

test('ambiguous teams and missing explicit lead are blocked, never first-member guesses', async t => {
  for (const manifest of [
    { agents: ['agents/reviewer.md', 'agents/lead.md'] },
    { agentName: 'missing', agents: ['agents/lead.md'] }
  ]) {
    const f = await fixture(t, manifest);
    await assert.rejects(buildExpertEntry(f.module), /unambiguous/);
  }
});

test('package escape, escaping symlink and non-Markdown lead are rejected', async t => {
  const f = await fixture(t, { agentName: 'outside', agents: ['../../outside.md'] });
  await assert.rejects(buildExpertEntry(f.module), /escapes/);
  const outside = await put(f.home, 'outside.md', '# Outside data');
  await symlink(outside, path.join(f.root, 'agents/escaped.md'));
  await put(f.root, '.codebuddy-plugin/plugin.json', JSON.stringify({ agents: ['agents/escaped.md'] }));
  await assert.rejects(buildExpertEntry(f.module), /symlink escapes/);
  await put(f.root, '.codebuddy-plugin/plugin.json', JSON.stringify({ agents: ['.env'] }));
  await assert.rejects(buildExpertEntry(f.module), /Markdown/);
});

test('invalid manifest and empty original role fail closed', async t => {
  const f = await fixture(t);
  await put(f.root, '.codebuddy-plugin/plugin.json', '{broken');
  await assert.rejects(buildExpertEntry(f.module), SyntaxError);
  await put(f.root, '.codebuddy-plugin/plugin.json', JSON.stringify({ agents: ['agents/lead.md'] }));
  await put(f.root, 'agents/lead.md', '  \n');
  await assert.rejects(buildExpertEntry(f.module), /empty/);
});

test('global upgrade changes only external entry; two different workspaces read the same original role', async t => {
  const f = await fixture(t);
  const catalog = await readFile(path.join(f.home, 'skill-registry/resource-modules.json'));
  const manifest = await readFile(path.join(f.root, '.codebuddy-plugin/plugin.json'));
  const originalAdapter = await readFile(f.module.path);
  const dry = await refreshExpertEntries({ codexRoot: f.home });
  assert.equal(dry.ready, 1); assert.equal(dry.changed, 1);
  assert.ok((await readFile(f.module.path)).equals(originalAdapter));
  const applied = await refreshExpertEntries({ codexRoot: f.home, install: true });
  assert.equal(applied.ready, 1); assert.equal(applied.blocked, 0);
  for (const workspace of ['workspace-a', 'workspace-b']) {
    await mkdir(path.join(f.home, workspace));
    assert.ok(path.isAbsolute(f.module.path));
    const entry = await readFile(path.resolve(f.home, workspace, f.module.path));
    assert.ok(entry.subarray(-f.original.length).equals(f.original));
  }
  assert.ok((await readFile(path.join(f.home, 'skill-registry/resource-modules.json'))).equals(catalog));
  assert.ok((await readFile(path.join(f.root, '.codebuddy-plugin/plugin.json'))).equals(manifest));
  assert.ok((await readFile(path.join(f.root, 'agents/lead.md'))).equals(f.original));
  assert.equal((await refreshExpertEntries({ codexRoot: f.home, install: true })).changed, 0);
});

test('upgrade replaces obsolete mapping with a clear blocked receipt for ambiguous teams', async t => {
  const f = await fixture(t, { agents: ['agents/lead.md', 'agents/reviewer.md'] });
  const result = await refreshExpertEntries({ codexRoot: f.home, install: true });
  assert.equal(result.blocked, 1); assert.equal(result.ready, 0);
  const entry = await readFile(f.module.path, 'utf8');
  assert.match(entry, /EXPERT_ENTRY_V1: BLOCKED/);
  assert.doesNotMatch(entry, /collaboration\.spawn_agent/);
});

test('upgrade rejects a catalog entry aimed at the original package', async t => {
  const f = await fixture(t);
  f.module.path = path.join(f.root, 'agents/lead.md');
  await put(f.home, 'skill-registry/resource-modules.json', JSON.stringify({ modules: [f.module] }));
  await assert.rejects(refreshExpertEntries({ codexRoot: f.home, install: true }), /Invalid.*entry path/);
  assert.ok((await readFile(f.module.path)).equals(f.original));
});
