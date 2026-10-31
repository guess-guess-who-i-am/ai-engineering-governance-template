// Real embedding installation into a temporary user profile; never production.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'global-install-e2e-'));
const home = path.join(temporary, '用户 home with spaces');
const library = path.join(temporary, 'fixture skills');
const source = fileURLToPath(new URL('./deploy-global-profile.mjs', import.meta.url));
const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'),
  HF_HOME: process.env.HF_HOME || path.join(os.homedir(), '.cache/huggingface'),
  CODEX_PROFILE_SKILL_SOURCE: library, CODEX_PYTHON: process.env.CODEX_PYTHON || (process.platform === 'win32' ? 'python' : 'python3') };
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [source, '--home', home, '--no-service', '--no-task-tree', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve(output) : reject(new Error(output)));
});
try {
  await mkdir(path.join(library, 'test-debug'), { recursive: true });
  await writeFile(path.join(library, 'test-debug/SKILL.md'), '---\nname: test-debug\ndescription: Diagnose a reproducible debugging failure.\n---\nRead evidence first.\n');
  await writeFile(path.join(library, '_catalog_cn.json'), JSON.stringify({ skills: [{ name: 'test-debug', dir: 'test-debug', description: 'debugging failures' }] }));
  await run([]);
  await run(['--check']);
  await run([]);
  const report = JSON.parse(await readFile(path.join(home, '.codex/install-report.json'), 'utf8'));
  assert.equal(report.ownedSkillCount, 22);
  assert.equal(report.externalSkillCount, 1);
  assert.equal(report.embedding, 'sentence-transformers/all-MiniLM-L6-v2');
  assert.equal(report.verificationScope, 'partial-test-only');
  assert.equal(report.service, 'not-tested');
  console.log('PASS real installation E2E: fresh user, 22+1 unified graph, real embedding, repeat install and drift check. Service/task-tree explicitly excluded from this fixture.');
} finally { await rm(temporary, { recursive: true, force: true }); }
