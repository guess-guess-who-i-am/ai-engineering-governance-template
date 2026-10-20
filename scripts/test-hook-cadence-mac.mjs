import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = path.join(root, 'codex-profile/mac/hooks/context-refresh.mjs');
const dispatcher = path.join(root, 'codex-profile/.codex/hooks/hook-dispatch.mjs');
const home = await mkdtemp(path.join(os.tmpdir(), 'hook-cadence-mac-'));
const codexHome = path.join(home, '.codex');
await mkdir(path.join(codexHome, 'prompts'), { recursive: true });
await writeFile(path.join(codexHome, 'prompts/global-attention-anchor.en.md'), 'FIXED_ANCHOR');
await writeFile(path.join(codexHome, 'prompts/global-methodology-router.en.md'), 'FIXED_ROUTER');

function invoke({ event = 'UserPromptSubmit', session = 'A', turn = '', source = '' } = {}) {
  const input = { hook_event_name: event, session_id: session, turn_id: turn, source, cwd: home };
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CODEX_HOME: codexHome }
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput?.additionalContext || '';
  return context;
}
const fixed = (context) => context.includes('FIXED_ANCHOR') && context.includes('FIXED_ROUTER');

assert.equal(fixed(invoke({ turn: '1' })), true);
assert.equal(fixed(invoke({ turn: '2' })), false);
assert.equal(fixed(invoke({ turn: '3' })), false);
assert.equal(fixed(invoke({ turn: '3' })), false, 'retry must not advance cadence');
assert.equal(fixed(invoke({ turn: '4' })), true);
assert.equal(fixed(invoke({ session: 'B', turn: '1' })), true, 'sessions are isolated');
assert.equal(fixed(invoke({ session: '', turn: '1' })), true, 'unknown sessions fail open');

assert.equal(fixed(invoke({ event: 'SessionStart', source: 'compact' })), true);
assert.equal(fixed(invoke({ turn: '5' })), true, 'first prompt after compaction reinjects');
assert.equal(fixed(invoke({ turn: '6' })), false);
assert.equal(fixed(invoke({ event: 'SessionStart', source: 'resume' })), true);
assert.equal(fixed(invoke({ turn: '7' })), true, 'first prompt after resume reinjects');

const brokenHome = path.join(home, 'broken-state');
await mkdir(path.join(brokenHome, 'prompts'), { recursive: true });
await writeFile(path.join(brokenHome, 'prompts/global-attention-anchor.en.md'), 'FIXED_ANCHOR');
await writeFile(path.join(brokenHome, 'prompts/global-methodology-router.en.md'), 'FIXED_ROUTER');
await writeFile(path.join(brokenHome, 'hooks'), 'not a directory');
const unavailable = spawnSync(process.execPath, [hook], {
  input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'broken', turn_id: '1', cwd: home }),
  encoding: 'utf8', env: { ...process.env, CODEX_HOME: brokenHome }
});
assert.equal(unavailable.status, 0);
assert.ok(unavailable.stderr.includes('Cadence state unavailable'));
assert.ok(fixed(JSON.parse(unavailable.stdout).hookSpecificOutput?.additionalContext || ''), 'state failure must not silently suppress fixed reminders');

const stateDir = path.join(codexHome, 'hooks/cadence-state');
const files = await readdir(stateDir);
assert.equal(files.filter((file) => file.endsWith('.json')).length, 2);
for (const file of files.filter((name) => name.endsWith('.json'))) {
  const data = JSON.parse(await readFile(path.join(stateDir, file), 'utf8'));
  assert.ok(data.count >= 1);
}

await copyFile(hook, path.join(codexHome, 'hooks/context-refresh.mjs'));
await writeFile(path.join(codexHome, 'hooks/skill-router.mjs'),
  'let s="";for await(const c of process.stdin)s+=c;const i=JSON.parse(s);console.log(JSON.stringify({hookSpecificOutput:{additionalContext:"ROUTE:"+i.turn_id}}));');
for (let turn = 1; turn <= 4; turn += 1) {
  const result = spawnSync(process.execPath, [dispatcher], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'dispatcher', turn_id: String(turn), prompt: 'route me', cwd: home }),
    encoding: 'utf8', env: { ...process.env, CODEX_HOME: codexHome }
  });
  assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(result.stdout).hookSpecificOutput?.additionalContext || '';
  assert.ok(context.includes(`ROUTE:${turn}`), `dynamic route missing on turn ${turn}`);
  assert.equal(fixed(context), turn === 1 || turn === 4);
  assert.ok(context.includes('Collect all currently known, ready, independent operations'), `ready-set batching missing on turn ${turn}`);
  assert.ok(context.includes('queries together'), `search batching missing on turn ${turn}`);
  assert.ok(context.includes('known URLs together'), `page batching missing on turn ${turn}`);
  assert.ok(context.includes('schema'), `host-specific limits missing on turn ${turn}`);
  if (turn === 1 || turn === 4) {
    assert.ok(context.includes('Do not make one model round trip per item'));
    assert.ok(context.includes('partial failures'));
    assert.ok(context.includes('semantic interpretation'));
  } else {
    assert.ok(context.includes('Preserve dependencies and serial safety'));
    assert.ok(context.length < 850, 'compact turn must not receive the full scheduling contract');
  }
}
console.log('PASS: cadence 1/4, retry, isolation, recovery and ready-set/search/page batching on every prompt.');
