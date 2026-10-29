import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyPortableProfile } from './deploy-global-profile.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'profile-copy-'));
try {
  const source = path.join(temp, '源 profile'), destination = path.join(temp, '用户 profile');
  await mkdir(path.join(source, '.codex/prompts/backups/history'), { recursive: true });
  await mkdir(path.join(source, 'global-skills/example'), { recursive: true });
  await writeFile(path.join(source, '.codex/prompts/active.md'), 'current');
  await writeFile(path.join(source, '.codex/prompts/backups/history/old.md'), 'old');
  await writeFile(path.join(source, 'global-skills/example/SKILL.md'), 'original module');
  await copyPortableProfile(source, destination);
  assert.equal(await readFile(path.join(destination, '.codex/prompts/active.md'), 'utf8'), 'current');
  assert.equal(await readFile(path.join(destination, 'global-skills/example/SKILL.md'), 'utf8'), 'original module');
  await assert.rejects(stat(path.join(destination, '.codex/prompts/backups')), { code: 'ENOENT' });
  await copyPortableProfile(source, destination);
  console.log('PASS: reusable one-click source retains runtime/Skills and excludes publisher history on repeated copies.');
} finally { await rm(temp, { recursive: true, force: true }); }
