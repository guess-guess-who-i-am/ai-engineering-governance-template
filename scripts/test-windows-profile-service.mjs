import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceDocument } from './global-profile-service.mjs';
if (process.platform !== 'win32') throw new Error('Windows native test only');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'graph-task-'));
const home = path.join(temporary, 'user with spaces');
const root = path.join(home, '.codex');
const task = 'CodexGlobalGraphTest' + process.pid;
const installer = fileURLToPath(new URL('./install-global-profile-service.ps1', import.meta.url));
const args = ['-NoProfile', '-File', installer, '-CodexRoot', root, '-TaskName', task];
const run = more => {
  const result = spawnSync('powershell.exe', [...args, ...more], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
};
try {
  await mkdir(path.join(root, 'hooks'), { recursive: true });
  const spec = serviceDocument({ platform: 'win32', home });
  await writeFile(spec.file, spec.text);
  const marker = path.join(root, 'started.json');
  await writeFile(path.join(root, 'hooks/graph-worker-supervisor.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`);
  run([]);
  const until = Date.now() + 20000;
  while (true) {
    try { await readFile(marker); break; } catch (error) { if (Date.now() > until) throw error; await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  const before = await readFile(marker, 'utf8');
  run(['-Check']);
  run([]);
  assert.equal(await readFile(marker, 'utf8'), before, 'repeat installation restarted running task');
  console.log('PASS native Windows scheduled task: login trigger, live process, private endpoint ACL, update without stopping. No boot-without-login claim.');
} finally {
  spawnSync('schtasks.exe', ['/End', '/TN', task]);
  spawnSync('schtasks.exe', ['/Delete', '/TN', task, '/F']);
  await rm(temporary, { recursive: true, force: true });
}
