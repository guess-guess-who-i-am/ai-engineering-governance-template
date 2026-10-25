#!/usr/bin/env node
// Fault only a disposable probe unit. Never stop/restart the production worker.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serviceText } from './install-global-graph-linux.mjs';

if (process.platform !== 'linux') throw new Error('Linux user systemd required');
const systemctl = args => execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const production = () => systemctl(['show', 'codex-graph-worker.service', '--property=MainPID', '--value']);
const before = production();
assert.notEqual(before, '0', 'production worker must already be running');
const root = await mkdtemp(path.join(os.tmpdir(), 'graph-restart-probe-'));
const script = path.join(root, 'probe.mjs');
const counter = path.join(root, 'count');
const name = `codex-graph-restart-probe-${process.pid}`;
const template = serviceText(os.homedir(), 8);
const properties = ['Restart', 'RestartSec', 'StartLimitIntervalSec'].map(key => {
  const value = template.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1];
  assert.ok(value, key + ' missing');
  return key + '=' + value;
});
assert.ok(properties.includes('Restart=always'));
assert.ok(properties.includes('StartLimitIntervalSec=0'));
let report;
try {
  await writeFile(script, `import {readFileSync,writeFileSync} from 'node:fs';const file=${JSON.stringify(counter)};let n=0;try{n=Number(readFileSync(file,'utf8'))}catch{}writeFileSync(file,String(++n));if(n<=6)process.exit(1);setTimeout(()=>{},60000);\n`, { mode: 0o600 });
  // Speed up only the disposable probe; production RestartSec remains unchanged.
  const arguments_ = ['--user', '--quiet', '--unit', name, ...properties.flatMap(value => ['--property', value.startsWith('RestartSec=') ? 'RestartSec=100ms' : value]), process.execPath, script];
  execFileSync('systemd-run', arguments_, { stdio: ['ignore', 'pipe', 'pipe'] });
  const deadline = Date.now() + 20000;
  let count = 0;
  while (Date.now() < deadline) {
    count = Number(await readFile(counter, 'utf8').catch(() => '0'));
    if (count >= 7 && systemctl(['is-active', name + '.service']) === 'active') break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(count, 7, 'service did not recover after more than five consecutive failures');
  const restarts = Number(systemctl(['show', name + '.service', '--property=NRestarts', '--value']));
  assert.ok(restarts >= 6);
  assert.equal(production(), before, 'production worker must remain untouched');
  report = { success: true, failedStarts: 6, attempts: count, restarts, productionPidBefore: before, productionPidAfter: production(), properties };
  console.log(JSON.stringify(report));
} finally {
  try { systemctl(['stop', name + '.service']); } catch { /* Preserve primary error. */ }
  await rm(root, { recursive: true, force: true });
}
const args = process.argv.slice(2);
if (args.includes('--output')) {
  const output = args[args.indexOf('--output') + 1];
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
