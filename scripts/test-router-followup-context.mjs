import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { routingQuery } from '../codex-profile/.codex/hooks/skill-router.mjs';
const dir = await mkdtemp(path.join(os.tmpdir(), 'routing-followup-'));
const transcript = path.join(dir, 'session.jsonl');
const task = '统一几个IDE发行副本的工具配置，修复运行时与验收JSON错误，并完成集成验证。';
const user = text => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
try {
  await writeFile(transcript, [user(task), user('就按这个统一吧')].map(JSON.stringify).join('\n') + '\n');
  const query = await routingQuery({ transcript_path: transcript }, '就按这个统一吧');
  assert.ok(query.includes(task), 'a deictic follow-up must retain the substantive user task');
  assert.ok(query.includes('就按这个统一吧'));
  assert.equal(await routingQuery({ transcript_path: transcript }, '请帮我预订东京酒店'), '请帮我预订东京酒店', 'topic change must not inherit IDE work');
  assert.equal(await routingQuery({}, '继续'), '', 'missing context must abstain, not retrieve arbitrary experts');
  assert.equal(await routingQuery({}, '$focused-workflow'), '$focused-workflow');
  const answer = '<send_user_message_question_reply>\n' + JSON.stringify([{questionItemId: 'opaque-id',
    question: '统一IDE发行版本，同时保持各项目树和服务隔离，还是合并为一个服务？',
    answer: '统一发行版本，树独立（推荐）'}]) + '\n</send_user_message_question_reply>';
  const normalized = await routingQuery({ transcript_path: transcript }, answer);
  assert.ok(normalized.includes('统一IDE发行版本'));
  assert.ok(normalized.includes('树独立'));
  assert.ok(!normalized.includes('questionItemId'), 'transport metadata is not retrieval intent');
  await writeFile(transcript, [user('<environment_context>not a user task</environment_context>'), user('继续')].map(JSON.stringify).join('\n') + '\n');
  assert.equal(await routingQuery({ transcript_path: transcript }, '继续'), '');
  await writeFile(transcript, [user('secret token=private-fixture-value-not-real'), user('继续')].map(JSON.stringify).join('\n') + '\n');
  assert.equal(await routingQuery({ transcript_path: transcript }, '继续'), '', 'do not propagate credentials from history');
  await writeFile(transcript, 'x'.repeat(1100000) + '\n' + JSON.stringify(user(task)) + '\n');
  assert.ok((await routingQuery({ transcript_path: transcript }, '继续')).includes(task), 'bounded tail survives partial first record');
  await assert.rejects(routingQuery({ transcript_path: path.join(dir, 'missing.jsonl') }, '继续'), /ENOENT/);
  console.log('PASS follow-up context, topic reset, abstention, synthetic messages, secret exclusion and bounded tail');
} finally { await rm(dir, { recursive: true, force: true }); }
