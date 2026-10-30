import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const source = process.env.ROUTER_UNDER_TEST
  ? pathToFileURL(path.resolve(process.env.ROUTER_UNDER_TEST))
  : new URL('../codex-profile/.codex/hooks/skill-router.mjs', import.meta.url);
const { routingQuery } = await import(source.href);

const task = '修复 Skill/MCP 图路由的专家推荐，核对两位专家与任务产物是否匹配。';
const actual = '我感觉你的评价指标有问题，就是你认为的正确推荐了，可能不是真正的正确推荐了？要不然你现在的什么48/68为什么还是推荐不到想要的？我感觉评价指标有问题你仔细根因分析一下，看看是不是这个问题？';
const fix = '那就赶紧帮我修好吧，有问题就仔细搜索，看看到底怎么完成，多根因分析多测试。每一步都仔细核验，不要为了工程实现方便就简要假设，始终记住最终要交付什么。'.repeat(3);
const cases = [
  {id: 'actual-95-character-followup', history: [task], prompt: actual, include: [task]},
  {id: 'long-followup', history: [task], prompt: fix, include: [task]},
  {id: 'followup-chain', history: [task, actual, '这个方案还需要保持全部配置全局可用。'], prompt: fix,
    include: [task, '全部配置全局可用']},
  {id: 'english-reference', history: ['Evaluate the two recommended experts against the required deliverables.'],
    prompt: 'These results still look wrong. Fix that problem and verify the earlier method using real outputs.',
    include: ['Evaluate the two recommended experts']},
  {id: 'short-followup', history: [task], prompt: '继续', include: [task]},
  {id: 'standalone-topic', history: [task], prompt: '请帮我预订东京酒店', exclude: [task]},
  {id: 'explicit-topic-reset', history: [task], prompt: '换个话题，请解释这个问题：酒店订单取消后为什么没有释放库存？', exclude: [task]},
  {id: 'locally-defined-question', history: [task], prompt: '请分析这个问题：酒店订单取消后库存没有释放。', exclude: [task]},
  {id: 'quoted-reference', history: [task], prompt: '请将“修复这个问题”翻译成英文。', exclude: [task]},
  {id: 'named-new-subject', history: [task], prompt: '请帮我设计这个酒店预订系统的订单表。', exclude: [task]},
  {id: 'self-contained-results', history: [task], prompt: '分析这个结果：酒店订单取消率从2%升到了8%。', exclude: [task]},
  {id: 'explicit-english-reset', history: [task], prompt: 'New topic: explain why this problem occurs in a hotel booking database.', exclude: [task]},
  {id: 'reset-then-followup', history: [task, '请排查PostgreSQL慢查询并解释执行计划。'],
    prompt: '这个问题再查一下，保留实际执行计划。', include: ['PostgreSQL'], exclude: [task]},
];
const dir = await mkdtemp(path.join(os.tmpdir(), 'routing-continuity-'));
const transcript = path.join(dir, 'session.jsonl');
const failures = [];
try {
  for (const item of cases) {
    await writeFile(transcript, [...item.history, item.prompt].map(text => JSON.stringify({
      type: 'response_item', payload: {type: 'message', role: 'user', content: [{type: 'input_text', text}]},
    })).join('\n') + '\n');
    const query = await routingQuery({transcript_path: transcript}, item.prompt);
    try {
      assert.ok(query.endsWith(item.prompt), 'latest request must remain intact');
      for (const text of item.include || []) assert.ok(query.includes(text), 'missing context: ' + text);
      for (const text of item.exclude || []) assert.ok(!query.includes(text), 'stale context: ' + text);
      if (!item.include) assert.equal(query, item.prompt);
    } catch (error) { failures.push({id: item.id, error: error.message}); }
  }
  assert.equal(await routingQuery({}, actual), actual, 'missing transcript must retain a substantive current request');
  assert.deepEqual(failures, [], JSON.stringify(failures));
  console.log(`PASS ${cases.length} context continuity, multi-turn constraints and topic-boundary cases`);
} finally { await rm(dir, {recursive: true, force: true}); }
