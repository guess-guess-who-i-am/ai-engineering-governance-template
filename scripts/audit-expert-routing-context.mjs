// Diagnostic reproduction; does not change the installed hook or retrieval.
import { routingQuery } from '../codex-profile/.codex/hooks/skill-router.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const report = process.argv[2];
if (!report) throw new Error('Usage: node scripts/audit-expert-routing-context.mjs REPORT.json');
const dir = await mkdtemp(path.join(os.tmpdir(), 'expert-context-audit-'));
const transcript = path.join(dir, 'session.jsonl');
const task = '请诊断 Skill/MCP 图路由的专家推荐，核对两席专家与真实需求是否匹配。';
const actual = '我感觉你的评价指标有问题，就是你认为的正确推荐了，可能不是真正的正确推荐了？要不然你现在的什么48/68为什么还是推荐不到想要的？我感觉评价指标有问题你仔细根因分析一下，看看是不是这个问题？';
try {
  await writeFile(transcript, JSON.stringify({type: 'response_item', payload: {
    type: 'message', role: 'user', content: [{type: 'input_text', text: task}],
  }}) + '\n');
  const rows = [];
  for (const [name, prompt] of [
    ['short-followup', '继续'], ['actual-followup', actual],
    ['long-followup', actual + '请逐项检查旧计分逻辑、专家原角色适用条件和任务最终产物。'],
    ['new-topic', '请帮我预订东京酒店'],
  ]) {
    const query = await routingQuery({transcript_path: transcript}, prompt);
    rows.push({name, promptLength: prompt.length, query,
      inheritedTask: query.includes(task), unchangedPrompt: query === prompt});
  }
  await writeFile(report, JSON.stringify({schema: 'routing-context-audit/v1', entry: 'routingQuery',
    fixture: 'Synthetic one-prior-message transcript; actual follow-up text supplied by user.',
    previousTask: task, rows, productionChanged: false,
    limitations: ['Tests context construction, not graph retrieval or overall long-dialogue accuracy.'],
  }, null, 2) + '\n');
  console.log(JSON.stringify(rows.map(({query, ...rest}) => rest)));
} finally {
  await rm(dir, {recursive: true, force: true});
}
