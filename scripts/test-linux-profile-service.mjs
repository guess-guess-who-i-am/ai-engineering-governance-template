import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serviceDocument } from './global-profile-service.mjs';
if (process.platform !== 'linux') throw new Error('Native Linux systemd user manager required');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'graph-service-test-'));
const name = `codex-profile-test-${process.pid}-${Date.now()}.service`;
const unit = path.join(os.homedir(), '.config/systemd/user', name);
const root = path.join(temporary, '.codex');
const systemctl = (...args) => {
  const result = spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
try {
  await mkdir(path.join(root, 'hooks'), { recursive: true });
  const marker = path.join(root, 'started.json');
  await writeFile(path.join(root, 'hooks/graph-worker-supervisor.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`);
  const spec = serviceDocument({ platform: 'linux', home: temporary, resources: { processes: 1, memoryHigh: 4, memoryMax: 6 } });
  await writeFile(unit, spec.text, { flag: 'wx', mode: 0o600 });
  systemctl('daemon-reload');
  systemctl('enable', '--now', name);
  const until = Date.now() + 10000;
  while (true) {
    try { await readFile(marker); break; } catch (error) { if (Date.now() > until) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const before = systemctl('show', name, '--property=MainPID', '--value');
  systemctl('daemon-reload');
  systemctl('enable', '--now', name);
  assert.equal(systemctl('show', name, '--property=MainPID', '--value'), before);
  assert.equal(systemctl('is-active', name), 'active');
  assert.equal(systemctl('is-enabled', name), 'enabled');
  assert.equal(systemctl('show', name, '--property=MemoryHigh', '--value'), String(4 * 1024 ** 3));
  console.log('PASS native Linux service: generated unit enabled/active, live Node process, memory limit, repeat activation unchanged PID. Production service untouched.');
} finally {
  spawnSync('systemctl', ['--user', 'disable', '--now', name]);
  await rm(unit, { force: true });
  spawnSync('systemctl', ['--user', 'daemon-reload']);
  await rm(temporary, { recursive: true, force: true });
}
