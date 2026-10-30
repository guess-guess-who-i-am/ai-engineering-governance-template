// Paired real Hooks against the same resident graph; no expert-name labels.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routingQuery } from '../codex-profile/.codex/hooks/skill-router.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const codex = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const baseline = process.argv[2] || path.join(codex, 'hooks/skill-router.mjs');
const candidate = path.join(root, 'codex-profile/.codex/hooks/skill-router.mjs');
const output = process.argv[3] || path.join(root, '.reports/expert-repair-20261030/continuity-live.json');
const sha = data => createHash('sha256').update(data).digest('hex');
const graph = path.join(codex, 'skill-registry/skills.graph.json');
const frozen = {graph: sha(await readFile(graph)), baseline: sha(await readFile(baseline)), candidate: sha(await readFile(candidate))};
const cases = [
  {id: 'metric-audit', history: ['修复 Skill/MCP 图路由的专家推荐，逐席核对原角色适用性，审计评价指标和测试证据。'],
    prompt: '我感觉你的评价指标有问题，就是你认为的正确推荐了，可能不是真正的正确推荐了？要不然你现在的什么48/68为什么还是推荐不到想要的？我感觉评价指标有问题你仔细根因分析一下，看看是不是这个问题？'},
  {id: 'incident-followup', history: ['线上支付突然大面积失败，请统一指挥事故止损、值班恢复，记录影响用户与时间线，事后交付根因和整改复盘。'],
    prompt: '这个问题还没有恢复，请继续排查，保留处理时间线，确保最终有可验证的整改产物。'},
  {id: 'security-followup', history: ['多租户后台中客户A能猜编号访问客户B的账单，请分析越权、威胁模型并提供修补和攻击复现验证。'],
    prompt: '这个方案再检查一下，别只修这一个入口，相关攻击路径和验证证据都要覆盖。'},
  {id: 'journal-followup', history: ['这篇关于城市热岛与老年健康的论文摘要，需要评估中文核心与SCI投稿，交付冲稳保选刊方案和依据。'],
    prompt: '这个结果还不够，请考虑主题匹配、收稿范围和投稿难度，把推荐理由核实清楚。'},
  {id: 'database-followup', history: ['PostgreSQL订单查询很慢，使用EXPLAIN ANALYZE检查执行计划、索引和扫描行数，验证修复前后延迟。'],
    prompt: '这个问题继续查，请保留执行计划，不要只给通用优化建议。'},
  {id: 'exam-followup', history: ['三个月后考研，每晚两小时，数学落后、英语词汇容易忘，请制定每日可调整计划、间隔复习与每周复盘。'],
    prompt: '这个计划需要能在落后时自动调整，今天做什么和周末怎么复盘都要具体。'},
  {id: 'standalone-reset', history: ['分析 Skill/MCP 路由的专家推荐指标。'], prompt: '请帮我预订东京酒店。'},
  {id: 'explicit-reset', history: ['分析 Skill/MCP 路由的专家推荐指标。'], prompt: '换个话题，请检查PostgreSQL慢查询执行计划和索引。'},
];
const temp = await mkdtemp(path.join(os.tmpdir(), 'hook-continuity-'));
const rows = Array(cases.length), intervals = [], began = performance.now();
let next = 0;
async function run(file, item, transcript, cwd) {
  const start = performance.now();
  const child = spawn(process.execPath, [file], {cwd, env: {...process.env, CODEX_HOME: codex}});
  let stdout = '', stderr = '', timedOut = false;
  const timer = setTimeout(() => {timedOut = true; child.kill();}, 60000);
  child.stdout.on('data', b => {stdout += b;}); child.stderr.on('data', b => {stderr += b;});
  child.stdin.end(JSON.stringify({hook_event_name: 'UserPromptSubmit', prompt: item.prompt, transcript_path: transcript, cwd}));
  const code = await new Promise((resolve, reject) => {child.on('close', resolve);child.on('error', reject);});
  clearTimeout(timer);
  assert.equal(code, 0, stderr); assert.equal(stderr, ''); assert.equal(timedOut, false);
  const context = JSON.parse(stdout).hookSpecificOutput?.additionalContext;
  assert.ok(context, 'Empty routing output is not success');
  const candidates = context.split(/\n(?=- )/).slice(1).map(block => {
    const match = block.match(/^- (.+?) \[([^;]+);/);
    assert.ok(match, 'Malformed candidate block');
    const moduleId = block.match(/\n  Module: (.+?); package:/)?.[1];
    return {name: match[1], kind: match[2], ...(moduleId ? {moduleId} : {})};
  });
  assert.equal(candidates.filter(x => x.kind === 'Complete expert module').length, 2);
  return {startMs: start - began, endMs: performance.now() - began, ms: performance.now() - start,
    bytes: Buffer.byteLength(context), context, candidates};
}
try {
  await Promise.all(Array.from({length: 4}, async (_, worker) => {
    while (next < cases.length) {
      const index = next++, item = cases[index], cwd = path.join(temp, String(index)); await mkdir(cwd);
      const transcript = path.join(cwd, 'transcript.jsonl');
      await writeFile(transcript, [...item.history, item.prompt].map(text => JSON.stringify({type: 'response_item',
        payload: {type: 'message', role: 'user', content: [{type: 'input_text', text}]}})).join('\n') + '\n');
      const results = {};
      for (const mode of index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        results[mode] = await run(mode === 'candidate' ? candidate : baseline, item, transcript, cwd);
        intervals.push({worker, case: item.id, mode, startMs: results[mode].startMs, endMs: results[mode].endMs});
      }
      results.anchorOnly = await run(candidate, {...item, prompt: item.history[0]}, transcript, cwd);
      intervals.push({worker, case: item.id, mode: 'anchorOnly', startMs: results.anchorOnly.startMs, endMs: results.anchorOnly.endMs});
      rows[index] = {...item, candidateQuery: await routingQuery({transcript_path: transcript}, item.prompt), ...results};
      if (item.id.includes('reset')) assert.deepEqual(results.candidate.candidates, results.baseline.candidates);
      console.log(JSON.stringify({id: item.id, baseline: results.baseline.candidates.filter(x => x.kind === 'Complete expert module'),
        candidate: results.candidate.candidates.filter(x => x.kind === 'Complete expert module'),
        anchorOnly: results.anchorOnly.candidates.filter(x => x.kind === 'Complete expert module')}));
    }
  }));
  assert.equal(sha(await readFile(graph)), frozen.graph);
  assert.equal(sha(await readFile(candidate)), frozen.candidate);
  assert.equal(sha(await readFile(baseline)), frozen.baseline);
  await mkdir(path.dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify({schema: 'hook-continuity-paired/v1', frozen, rows, intervals,
    concurrency: 4, wallMs: performance.now() - began, productionChanged: false,
    limitations: ['Directed development cases, not independent population accuracy.',
      'Cached resident graph; timings include CPU scheduling and cannot establish speedup.',
      'Candidate names are not relevance judgments; original-role review is required.',
      'No downstream expert workflow executed. Context bytes are not model tokens.']}, null, 2) + '\n');
} finally {await rm(temp, {recursive: true, force: true});}
