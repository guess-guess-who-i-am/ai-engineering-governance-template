import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repo, 'codex-profile/.codex');
const fixture = await mkdtemp(path.join(os.tmpdir(), 'methodology-target-'));
const config = JSON.parse(await readFile(path.join(source, 'prompt-publisher/methodology-targets.json'), 'utf8'));
await mkdir(path.join(fixture, 'prompts'));
await mkdir(path.join(fixture, 'prompt-publisher'));
for (const name of ['global-every-turn.en.md', 'global-every-turn.zh.md', 'global-attention-anchor.en.md',
  'global-attention-anchor.zh.md', 'global-methodology-routing-review.zh.md', 'global-methodology-map.json']) {
  await copyFile(path.join(source, 'prompts', name), path.join(fixture, 'prompts', name));
}
for (const route of config.routes.filter(route => route.skillFile)) {
  const original = path.resolve(source, 'prompt-publisher', route.skillFile);
  route.skillFile = path.join(fixture, 'configured-consumers', route.id, 'SKILL.md');
  await mkdir(path.dirname(route.skillFile), { recursive: true });
  await copyFile(original, route.skillFile);
}
await writeFile(path.join(fixture, 'prompt-publisher/methodology-targets.json'), JSON.stringify(config));
const run = () => spawnSync(process.execPath, [path.join(repo, 'codex-profile/mac/hooks/validate-methodology-routing.mjs')], {
  encoding: 'utf8', windowsHide: true, env: { ...process.env, CODEX_HOME: fixture }
});
const valid = run();
assert.equal(valid.status, 0, valid.stderr);
const consumer = config.routes.find(route => route.id === 'method-engineering-execution').skillFile;
const text = await readFile(consumer, 'utf8');
await writeFile(consumer, text.split('\n').filter(line => !line.startsWith('- ')).join('\n'));
const invalid = run();
assert.notEqual(invalid.status, 0, 'a broken configured consumer must fail even when the installed Skill is valid');
assert.match(invalid.stderr, /not an exact line in method-engineering-execution target/);
console.log('PASS: routing validation follows configured consumers and rejects real consumer drift.');
