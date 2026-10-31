#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderRoutingContext } from '../codex-profile/.codex/hooks/skill-router.mjs';

const fixture = (name, kind, extra = {}) => ({ skill: {
  name, kind, description: `Exact description for ${name}`, path: `/fixture/${name}/MODULE.md`,
  moduleId: `${kind}:${name}`, packageRoot: `/fixture/${name}`, memberCount: 1,
  availability: { state: 'unverified', authentication: 'required', audit_flags: ['host-tool-hints'] },
  ...extra
}, score: 7, matches: ['GraphToolCall low'] });
const items = [fixture('expert-a', 'expert'), fixture('expert-b', 'expert'),
  ...[1, 2, 3, 4].map(i => fixture(`skill-${i}`, 'skill')),
  fixture('service-a', 'mcp-service'), fixture('service-b', 'mcp-service', {
    availability: { state: 'known-helper-failure', source_audit: 'fixture failing helper' }
  })];
const context = renderRoutingContext(items, '/fixture/global');
assert.equal((context.match(/^- /gm) || []).length, 8);
for (const removed of ['Indexed is not execution-verified', 'do not claim a module',
  'Loading or timeout never implies completion', 'unrelated functions remain unverified']) {
  assert.ok(!context.includes(removed), removed);
}
assert.equal((context.match(/original primary role verbatim/g) || []).length, 1);
for (const item of items) {
  const { skill } = item;
  for (const value of [skill.name, skill.description, skill.path, skill.moduleId,
    skill.packageRoot, JSON.stringify(skill.availability)]) assert.ok(context.includes(value), value);
}
assert.ok(context.includes('Known helper failure'));
for (const file of ['skills-audit.json', 'experts-audit.json', 'mcp-audit.json', 'package-integrity.json']) {
  assert.ok(context.includes(file), file);
}
const plain = renderRoutingContext([fixture('plain', 'skill', { moduleId: '' })], '/fixture/global');
assert.ok(!plain.includes('Audit evidence'));
assert.ok(!plain.includes('original primary role verbatim'));
console.log('PASS concise routing guidance; 8 candidates, original entries, availability and specific failures preserved');
