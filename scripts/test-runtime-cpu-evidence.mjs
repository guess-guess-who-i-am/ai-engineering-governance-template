import assert from 'node:assert/strict';
import { verifyCpuEvidence } from './runtime-cpu-evidence.mjs';
// Observed intervals from the first real 194 ephemeral Codex smoke test.
const observed = [
  'PID=6 START_MS=1792310289993 END_MS=1792310290193',
  'PID=7 START_MS=1792310289993 END_MS=1792310290193',
  'PID=8 START_MS=1792310289997 END_MS=1792310290197',
  'PID=5 START_MS=1792310290001 END_MS=1792310290201'
].join('\n');
assert.equal(verifyCpuEvidence([{ type: 'commandExecution', exitCode: 0, output: observed }]).peak, 4);
assert.throws(() => verifyCpuEvidence([{ type: 'agentMessage', text: observed }]), /intervals/);
assert.throws(() => verifyCpuEvidence([{ type: 'commandExecution', exitCode: 1, output: observed }]), /intervals/);
const serial = Array.from({ length: 4 }, (_, n) => `PID=${n + 1} START_MS=${n * 300} END_MS=${n * 300 + 200}`).join('\n');
assert.throws(() => verifyCpuEvidence([{ type: 'commandExecution', exitCode: 0, output: serial }]), /overlap/);
const namespaces = Array.from({ length: 4 }, (_, n) => ({ id: `sandbox-${n}`, type: 'commandExecution', exitCode: 0,
  output: 'PID=2 START_MS=1000 END_MS=1200' }));
assert.equal(verifyCpuEvidence(namespaces).peak, 4);
assert.throws(() => verifyCpuEvidence(namespaces.map(item => ({ ...item, id: undefined }))), /identities/);
console.log('CPU evidence: observed 194 overlap accepted; assistant-only, failed and serial claims rejected');
