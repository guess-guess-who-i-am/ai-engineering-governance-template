import assert from 'node:assert/strict';
import { auditRecords } from './audit-thread-expert-use.mjs';
const target = '/fixture/resource-adapters/abc/MODULE.md';
const command = (id, text, output = '') => ({ timestamp: 'fixture', payload: { type: 'item_completed', item: {
  type: 'CommandExecution', id, command: ['/bin/zsh', '-lc', text], exit_code: 0, aggregated_output: output
} } });
const rows = [command('1', `rg foo ${target}`), command('2', `cat ${target}`, '[EXPERT_ENTRY_V1: ORIGINAL_ROLE_LOADED]'),
  command('3', `head ${target}`), { payload: { role: 'developer', content: [{ text:
    '[CODEX_SKILL_ROUTER_V2]\n- expert [Complete expert module; score=4]\n  Read: ' + target }] } }];
const report = auditRecords([...rows, rows[1]]);
assert.equal(report.commands, 3);
assert.equal(report.referencesOnly.length, 1);
assert.equal(report.entryReads.length, 2);
assert.equal(report.entryReads.filter(r => r.completeRead).length, 1);
assert.deepEqual(report.routes[0].candidates, [{ name: 'expert', kind: 'Complete expert module' }]);
console.log('PASS desktop command arrays, duplicate events, search/read distinction and original-role marker');
