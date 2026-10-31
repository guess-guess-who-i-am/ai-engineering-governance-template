import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const launcher = '.codex/hooks/run-node-hook.sh';
const { CODEX_NODE: _ignoredCodexNode, ...baseEnv } = process.env;
const env = { ...baseEnv, PATH: '/usr/bin:/bin', CODEX_HOME: '/missing/codex-home' };
const resolved = spawnSync('/bin/sh', [launcher, 'turn-start.mjs', '--resolve-node'], { encoding: 'utf8', env });
const bundledNode = '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node';
if (existsSync(bundledNode)) {
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), bundledNode);
} else {
  assert.equal(resolved.status, 127);
  assert.match(resolved.stderr, /Node.js runtime not found/);
}
const rejected = spawnSync('/bin/sh', [launcher, 'arbitrary.mjs', '--resolve-node'], { encoding: 'utf8', env });
assert.equal(rejected.status, 64);
console.log('PASS project Hook Node launcher: minimal PATH, bundled runtime fallback, actionable missing-runtime error, and entry allowlist.');
