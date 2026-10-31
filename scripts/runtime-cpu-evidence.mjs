import assert from 'node:assert/strict';

export function verifyCpuEvidence(items) {
  const rows = [];
  for (const item of items) {
    if (item.type !== 'commandExecution' || item.exitCode !== 0) continue;
    for (const match of (item.output || '').matchAll(/^PID=(\d+) START_MS=(\d+) END_MS=(\d+)\s*$/gm)) {
      rows.push({ executionId: item.id || 'shared', pid: Number(match[1]), start: Number(match[2]), end: Number(match[3]) });
    }
  }
  assert.equal(rows.length, 4, 'four real command-output intervals required');
  // Separate sandbox executions can each expose PID=2. Scope the reported
  // identity to the real execution ID; intervals still must actually overlap.
  assert.equal(new Set(rows.map(row => `${row.executionId}:${row.pid}`)).size, 4, 'four distinct execution/process identities required');
  assert.ok(rows.every(row => row.end - row.start >= 180), 'each child must perform approximately 200ms work');
  const peak = Math.max(...rows.map(row => rows.filter(other => other.start <= row.start && row.start < other.end).length));
  assert.equal(peak, 4, 'actual overlap, not an assistant statement, must prove concurrency');
  return { rows, peak };
}
