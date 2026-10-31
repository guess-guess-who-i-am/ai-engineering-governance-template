#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, symlink, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { importResources, scalar } from './import-resource-modules.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const skillText = '---\r\nname: fixture\r\ndescription: >-\r\n  Plan travel budgets\r\n  with reusable city data.\r\nlicense: MIT\r\n---\r\n# Fixture Skill\r\n\r\nRead references/nested/guide.md.\r\n';
async function put(root, relative, value) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
  return file;
}
async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'resource-import-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source'), output = path.join(temp, 'global');
  const skillEntry = await put(source, 'packages/fixture/SKILL.md', skillText);
  await put(source, 'packages/fixture/references/nested/guide.md', '# Reference\nKeep the complete relative hierarchy.\n');
  await put(source, 'packages/fixture/scripts/helper.js', 'export const value = 42;\n');
  const alternateEntry = await put(source, 'packages/fixture-v2/SKILL.md', skillText.replace('Fixture Skill', 'Fixture Skill Version Two'));
  const expertRoot = path.join(source, 'experts/travel-team');
  await put(expertRoot, '.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'travel-team', description: 'Complete travel team', agentName: 'lead', agents: ['agents/lead.md', 'agents/reviewer.md'], license: 'MIT' }));
  await put(expertRoot, 'agents/lead.md', '# Lead\nDelegate to reviewer and consume data/prices.json.\n');
  await put(expertRoot, 'agents/reviewer.md', '# Reviewer\nReview the lead deliverable.\n');
  await put(expertRoot, 'data/prices.json', '{"daily":100}\n');
  await put(expertRoot, 'skills/budget/SKILL.md', '# Attached Skill\nUse ../../data/prices.json.\n');
  const preferred = { name: 'fixture', path: skillEntry, package_hash: hash('fixture-package-v1'), entry_hash: hash(skillText), status: 'fixture' };
  const alternate = { ...preferred, path: alternateEntry, package_hash: hash('fixture-package-v2'), entry_hash: hash(await readFile(alternateEntry)) };
  const experts = [{ name: 'travel-team', path: expertRoot, package_hash: hash('travel-team-package'), status: 'fixture' }];
  const audits = { 'skills.json': [preferred], 'skills-all.json': [preferred, { ...preferred }, alternate], 'experts.json': experts, 'mcp.json': [] };
  for (const [name, rows] of Object.entries(audits)) await put(source, '审计/' + name, JSON.stringify(rows));
  return { temp, source, output, skillEntry, expertRoot, audits };
}

test('description scalars retain folded and literal multiline meaning', () => {
  assert.equal(scalar(skillText, 'description'), 'Plan travel budgets with reusable city data.');
  assert.equal(scalar('---\ndescription: |\n  First line\n  Second line\nname: other\n---\n', 'description'), 'First line\nSecond line');
  assert.equal(scalar('---\ndescription: "Quoted text"\n---\n', 'description'), 'Quoted text');
});

test('expert retrieval scope comes from the original primary role, not marketing or repeated examples', async t => {
  const f = await fixture(t);
  const description = 'Analyze paid search accounts, search term reports and negative keywords to reduce wasted advertising spend.';
  const role = `---\nname: lead\ndescription: ${description}\n---\n# Paid Media Analyst\n\nOptimize paid-search advertising accounts.\n`;
  await put(f.expertRoot, 'agents/lead.md', role);
  await put(f.expertRoot, '.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'travel-team',
    description: 'Universal search intent and database analysis', displayDescription: {en:'Universal search intent and database analysis'},
    defaultInitPrompt: 'INITIAL_PROMPT_SENTINEL', tags: ['TAG_SENTINEL'],
    quickPrompts: ['QUICK_EXAMPLE_SENTINEL', 'Search all databases'], agentName: 'lead', agents: ['agents/lead.md'] }));
  for (const install of [false, true]) {
    const { catalog } = await importResources({ ...f, install });
    const expert = catalog.modules.find(m => m.kind === 'expert');
    assert.equal(expert.original_description, description);
    assert.equal(expert.description, `travel-team ${description}`);
    assert.equal(expert.retrieval_provenance.primary_sha256, hash(role));
    assert.equal(expert.retrieval_provenance.primary_path, 'agents/lead.md');
    assert.equal(expert.retrieval_document, 'travel-team Universal search intent and database analysis');
    assert.doesNotMatch(expert.retrieval_original_document, /SENTINEL|Search all databases/);
    assert.doesNotMatch(expert.description, /Universal|databases/);
    assert.equal(await readFile(path.join(f.expertRoot, 'agents/lead.md'), 'utf8'), role);
  }
});

test('complete expert roles, data and attached Skills survive installation without source edits', async t => {
  const f = await fixture(t);
  const { catalog, summary } = await importResources({ ...f, install: true, concurrency: 4 });
  assert.deepEqual(summary.moduleCounts, { expert: 1, skill: 2, 'mcp-service': 0 });
  const expert = catalog.modules.find(m => m.kind === 'expert');
  assert.deepEqual(expert.members.map(m => m.path).sort(), ['agents/lead.md', 'agents/reviewer.md']);
  for (const relative of ['.codebuddy-plugin/plugin.json', 'agents/lead.md', 'agents/reviewer.md', 'data/prices.json', 'skills/budget/SKILL.md']) {
    assert.deepEqual(await readFile(path.join(expert.package_root, relative)), await readFile(path.join(f.expertRoot, relative)));
  }
  const first = catalog.modules.find(m => m.entry_hash === hash(skillText));
  assert.deepEqual(await readFile(first.path), await readFile(f.skillEntry), 'original CRLF and every byte must survive');
  assert.equal(first.original_description, 'Plan travel budgets with reusable city data.');
  assert.equal(await readFile(path.join(first.package_root, 'references/nested/guide.md'), 'utf8'), '# Reference\nKeep the complete relative hierarchy.\n');
  assert.notEqual(expert.path, path.join(expert.package_root, 'agents/lead.md'), 'adapter must not replace original role');
  assert.match(await readFile(expert.path, 'utf8'), /Complete expert module/i);
  assert.match(await readFile(expert.path, 'utf8'), /EXPERT_ENTRY_V1: ORIGINAL_ROLE_LOADED/);
  assert.ok((await readFile(expert.path)).subarray(-(await readFile(path.join(f.expertRoot, 'agents/lead.md'))).length)
    .equals(await readFile(path.join(f.expertRoot, 'agents/lead.md'))));
  assert.doesNotMatch(await readFile(expert.path, 'utf8'), /Map original TeamCreate/);
});

test('identical content duplicates collapse while different content versions remain separately addressable', async t => {
  const f = await fixture(t);
  const { catalog } = await importResources({ ...f, install: false, concurrency: 4 });
  const skills = catalog.modules.filter(m => m.kind === 'skill');
  assert.equal(skills.length, 2);
  assert.equal(new Set(skills.map(m => m.id)).size, 2);
  assert.equal(new Set(skills.map(m => m.package_root)).size, 2);
  assert.equal(new Set(skills.map(m => m.entry_hash)).size, 2);
});

test('external symlinks and sensitive files are excluded with explicit omission receipts', async t => {
  const f = await fixture(t), packageRoot = path.dirname(f.skillEntry);
  const external = await put(f.temp, 'outside-private.txt', 'not-package-content');
  await symlink(external, path.join(packageRoot, 'outside-link.txt'));
  await symlink(path.join(f.temp, 'does-not-exist'), path.join(packageRoot, 'broken-link.txt'));
  for (const name of ['.env', '.env.production', 'auth.json', 'credentials.json', 'private.key', '.git/config']) await put(packageRoot, name, 'secret-fixture-only');
  const { catalog } = await importResources({ ...f, install: true, concurrency: 4 });
  const skill = catalog.modules.find(m => m.entry_hash === hash(skillText));
  for (const name of ['outside-link.txt', 'broken-link.txt', '.env', '.env.production', 'auth.json', 'credentials.json', 'private.key', '.git']) {
    await assert.rejects(access(path.join(skill.package_root, name)), undefined, `must not copy ${name}`);
    assert(skill.install_receipt.omitted.some(row => row.path === name), `missing omission receipt: ${name}`);
  }
  assert.equal(skill.install_receipt.omitted.find(row => row.path === 'outside-link.txt').reason, 'external-symlink');
  assert.equal(skill.install_receipt.omitted.find(row => row.path === 'broken-link.txt').reason, 'broken-source-symlink');
});

test('nested Skill uses complete expert parent only when the corresponding entry bytes match', async t => {
  const f = await fixture(t), expertRoot = path.join(f.source, 'experts/full/lazy-travel-planner');
  const nested = await put(expertRoot, 'skills/budget-balance/SKILL.md', skillText);
  await put(expertRoot, '.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'lazy-travel-planner', agents: ['agents/lead.md'] }));
  await put(expertRoot, 'agents/lead.md', '# Travel lead');
  await put(expertRoot, 'data/price_benchmark.json', '{"prices":[100]}');
  const nestedRow = { name: 'budget-balance', path: nested, package_hash: hash('budget-package'), entry_hash: hash(skillText) };
  const expertRow = { name: 'lazy-travel-planner', path: expertRoot, package_hash: hash('travel-parent-package') };
  await put(f.source, '审计/skills.json', JSON.stringify([nestedRow]));
  await put(f.source, '审计/skills-all.json', JSON.stringify([nestedRow]));
  await put(f.source, '审计/experts.json', JSON.stringify([expertRow]));
  const { catalog } = await importResources({ ...f, install: true, concurrency: 4 });
  const skill = catalog.modules.find(m => m.kind === 'skill'), expert = catalog.modules.find(m => m.kind === 'expert');
  assert.equal(skill.package_root, expert.package_root);
  assert.equal(skill.path, path.join(expert.package_root, 'skills/budget-balance/SKILL.md'));
  assert(skill.dependencies.includes(expert.id));
  assert.equal(skill.availability.relative_layout, 'complete-enclosing-expert-package');
  assert.equal(await readFile(path.join(skill.package_root, 'data/price_benchmark.json'), 'utf8'), '{"prices":[100]}');

  const otherExpert = path.join(f.source, 'other-expert');
  await put(otherExpert, '.codebuddy-plugin/plugin.json', '{}');
  await put(otherExpert, 'skills/budget-balance/SKILL.md', skillText.replace('travel budgets', 'travel mismatches'));
  await put(f.source, '审计/experts.json', JSON.stringify([{ ...expertRow, path: otherExpert }]));
  const different = await importResources({ ...f, output: path.join(f.temp, 'mismatch-global'), install: true, concurrency: 4 });
  const kept = different.catalog.modules.find(m => m.kind === 'skill');
  assert.notEqual(kept.package_root, different.catalog.modules.find(m => m.kind === 'expert').package_root);
  assert(!kept.dependencies.includes(expert.id));
  assert.deepEqual(await readFile(kept.path), await readFile(nested));
});

test('source entry changed after audit cannot replace the last valid catalog', async t => {
  const f = await fixture(t);
  await importResources({ ...f, install: true, concurrency: 4 });
  const catalogPath = path.join(f.output, 'skill-registry/resource-modules.json');
  const before = await readFile(catalogPath);
  await writeFile(f.skillEntry, skillText.replace('travel budgets', 'broken budgets'));
  await assert.rejects(importResources({ ...f, install: true, concurrency: 4 }), /changed|checksum|incomplete|hash/i);
  assert.deepEqual(await readFile(catalogPath), before);
});

test('repeated installation repairs same-size corruption in entry and nested attachments', async t => {
  const f = await fixture(t);
  const { catalog } = await importResources({ ...f, install: true, concurrency: 4 });
  const skill = catalog.modules.find(m => m.entry_hash === hash(skillText));
  const attachment = path.join(skill.package_root, 'references/nested/guide.md');
  const originalAttachment = await readFile(attachment);
  await writeFile(skill.path, Buffer.alloc((await readFile(skill.path)).length, 120));
  await writeFile(attachment, Buffer.alloc(originalAttachment.length, 120));
  await importResources({ ...f, install: true, concurrency: 4 });
  assert.deepEqual(await readFile(skill.path), await readFile(f.skillEntry));
  assert.deepEqual(await readFile(attachment), originalAttachment);
});
