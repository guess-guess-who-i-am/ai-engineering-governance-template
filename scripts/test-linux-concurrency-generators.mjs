// Run against a checkout containing the Linux generators (the stable-hook-dispatch branch).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(process.argv[2] || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const initial = '[features]\nmulti_agent = true\nplugins = false\nremote_plugin = false\n[agents]\nenabled = true\nmax_concurrent_threads_per_session = 20\n';
for (const script of ['repair-codex-linux-config.mjs', 'configure-lazy-capabilities-linux.mjs']) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'linux-concurrency-generator-'));
  const codex = path.join(home, '.codex');
  await mkdir(path.join(codex, 'hooks'), { recursive: true });
  await writeFile(path.join(codex, 'config.toml'), initial, { mode: 0o600 });
  await writeFile(path.join(codex, 'hooks/refresh-skill-registry.mjs'), 'process.stdout.write("{}");');
  const result = spawnSync(process.execPath, [path.join(repository, 'scripts', script), '--home', home], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const config = await readFile(path.join(codex, 'config.toml'), 'utf8');
  assert.match(config, /multi_agent = true/, `${script} must not disable multi-agent`);
  assert.match(config, /max_concurrent_threads_per_session = 20/, `${script} must not erase the concurrency limit`);
  if (script.startsWith('configure-lazy')) {
    const profile = await readFile(path.join(codex, 'full-tools.config.toml'), 'utf8');
    assert.match(profile, /multi_agent = true/, 'full-tools profile must not override the global feature to false');
  }
}
console.log('PASS: Linux repair and lazy-capability generators retain multi-agent and the 20-thread limit; full-tools also retains multi-agent.');
