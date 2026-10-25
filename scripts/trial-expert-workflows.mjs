#!/usr/bin/env node
// Frozen tasks -> real global dispatcher -> candidates. Never rewrites production.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(root, '.reports/expert-workflows-20261025');
const home = path.join(os.homedir(), '.codex');
const node = '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = [
  { id: 'performance', expert: 'performance-testing-expert', task: '对隔离工作区中的本地请求队列做一次有证据的性能评估：建立基线，比较容量1和6，测正常、突发60请求、错峰10/5/20请求的p50、p95、吞吐和正确结果ID，交替多次运行，定位瓶颈并输出报告。不要压测生产、访问外网或修改全局配置；不做长期耐久测试，不把人为提高容量的收益归功于提示词。' },
  { id: 'review', expert: 'code-review-expert', task: '审查隔离工作区中的小型Node.js文件读取与余额更新实现，对照SPEC检查安全、并发正确性和边界。只报告能用本地探针复现的具体缺陷，标出文件行号、影响、复现和修复建议；不要修改被审查实现，不访问外网或修改全局配置。' },
  { id: 'backend', expert: 'backend-architect', task: '为本地文件索引服务设计后端架构：一个常驻worker共享预热索引，最多100个错峰并发请求，索引更新后原子切换版本，每个查询只能读取一个完整版本，启动失败要明确报错。输出接口、数据模型、并发与发布流程、失败语义和可执行的最小一致性验证。仅在隔离工作区做合成实验，不部署服务、不改全局配置、不访问外网。' }
];

function dispatch(prompt, cwd, sessionId) {
  return new Promise(resolve => {
    const began = performance.now();
    const child = spawn(node, [path.join(home, 'hooks/hook-dispatch.mjs')], { cwd });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), 70000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); resolve({ error: error.message }); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const context = JSON.parse(stdout).hookSpecificOutput?.additionalContext || '';
        const router = context.slice(context.indexOf('[CODEX_SKILL_ROUTER_V2]'));
        const candidates = router.split('\n- ').slice(1).map(block => {
          const heading = block.match(/^(.+?) \[([^;]+);/);
          return heading && { name: heading[1], kind: heading[2], moduleId: block.match(/\n  Module: (.+?);/)?.[1],
            entry: block.match(/\n  Read: (.+)/)?.[1] };
        }).filter(Boolean);
        resolve({ code, ms: performance.now() - began, stderr, contextChars: context.length,
          routerPresent: context.includes('[CODEX_SKILL_ROUTER_V2]'), candidates, routerContext: router });
      } catch { resolve({ code, ms: performance.now() - began, error: 'No valid dispatcher output', stderr }); }
    });
    child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd, session_id: sessionId }));
  });
}

await mkdir(directory, { recursive: true });
const frozen = path.join(directory, 'cases.json');
try { await writeFile(frozen, JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
if (JSON.stringify(JSON.parse(await readFile(frozen))) !== JSON.stringify(cases)) throw new Error('Frozen tasks changed');
const files = ['hooks/skill-router.mjs', 'hooks/hook-dispatch.mjs', 'skill-registry/skills.graph.json', 'skill-registry/resource-modules.json'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, sha(await readFile(path.join(home, name)))])));
const before = await hashes();
const rows = await Promise.all(cases.map(async entry => {
  const cwd = path.join(directory, entry.id); await mkdir(cwd, { recursive: true });
  const natural = await dispatch(entry.task, cwd, 'expert-trial-' + entry.id + '-natural');
  const naturalHit = natural.candidates?.some(candidate => candidate.name === entry.expert && candidate.kind === 'Complete expert module') || false;
  // A named control isolates execution from missed automatic recall; never hide it.
  const control = await dispatch(`请使用 ${entry.expert} 完整专家模块。${entry.task}`, cwd, 'expert-trial-' + entry.id + '-named');
  const nameOnly = entry.id === 'review' ? await dispatch(entry.expert, cwd, 'expert-trial-review-name-only') : undefined;
  return { ...entry, cwd, natural, naturalHit, namedControl: control,
    namedHit: control.candidates?.some(candidate => candidate.name === entry.expert && candidate.kind === 'Complete expert module') || false,
    ...(nameOnly ? { nameOnly } : {}) };
}));
const after = await hashes();
const report = { schemaVersion: 'expert-workflow-routing/1', frozenTasksSha256: sha(await readFile(frozen)),
  before, after, productionUnchanged: JSON.stringify(before) === JSON.stringify(after), rows,
  naturalHits: rows.filter(row => row.naturalHit).length, namedHits: rows.filter(row => row.namedHit).length,
  limitations: ['Three selected diagnostic tasks, not a representative benchmark.', 'Hook subprocess, not an independent automatic model selection test.', 'No workflow execution is claimed by this routing script.'] };
await writeFile(path.join(directory, 'routing.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: rows.map(({ id, natural, naturalHit, namedControl, namedHit }) => ({ id, naturalHit, namedHit,
  natural: natural.candidates, named: namedControl.candidates, ms: [natural.ms, namedControl.ms], errors: [natural.error, namedControl.error, natural.stderr, namedControl.stderr] })) }));
