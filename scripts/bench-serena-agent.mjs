#!/usr/bin/env node
// End-to-end read-only Codex pair. Preserve only answers, usage and tool names;
// never persist provider stderr, authentication, or unrelated raw tool output.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const binary = process.argv[2];
if (!binary) throw new Error('Pass the Codex executable');
const output = process.argv[3] || '.reports/serena-agent-pair.json';
const cwd = process.cwd();
const question = '只读测试当前仓库。只检查 codex-profile/.codex/hooks/skill-router.mjs 的 queryTokens 函数，回答 JSON：tokenLimit 是多少，chineseGramSizes 是什么数组。不要修改任何文件，不要读取配置或认证文件。不要执行与此题无关的工作。';
function trial(arm) {
  return new Promise(resolve => {
    const prompt = question + (arm === 'serena' ? '用 Serena 激活当前项目并调用 find_symbol(include_body=true)。' : '不要使用 Serena；用本地文件工具定位函数并仅读取所需行。');
    const child = spawn(binary, ['exec', '--ephemeral', '--json', '-s', 'read-only', '-C', cwd, prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    const start = performance.now();
    let buffer = '', answers = [], usage, tools = [], toolResults = [], errors = [], timedOut = false;
    child.stderr.resume();
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180000);
    child.stdout.on('data', c => {
      buffer += c;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'turn.completed') usage = event.usage;
        if (event.type === 'item.completed') {
          const item = event.item;
          if (item.type === 'agent_message') answers.push(item.text);
          if (item.type === 'mcp_tool_call') {
            tools.push(`${item.server}/${item.tool}`);
            toolResults.push({ tool: item.tool, status: item.status, isError: item.result?.isError,
              hasError: Boolean(item.error), resultBytes: JSON.stringify(item.result || {}).length });
          }
          if (item.type === 'command_execution') tools.push('local-command');
          if (item.type === 'error') errors.push('runtime-error');
        }
      }
    });
    child.on('error', () => errors.push('spawn-error'));
    child.on('close', code => {
      clearTimeout(timer);
      const final = answers.at(-1);
      let answer; try { answer = JSON.parse(final?.replace(/^```json\s*|\s*```$/g, '')); } catch { /* invalid output */ }
      const correct = answer?.tokenLimit === 100 && JSON.stringify(answer?.chineseGramSizes) === '[2,3]';
      const result = { arm, code, timedOut, seconds: (performance.now() - start) / 1000, correct, answer, tools, toolResults, usage, errors };
      console.log(JSON.stringify(result)); resolve(result);
    });
  });
}
// Sequential paired arms avoid competition for the same backend/session caches.
const rows = [];
for (const arm of ['bounded-local', 'serena']) rows.push(await trial(arm));
await mkdir('.reports', { recursive: true });
await writeFile(output, JSON.stringify({ schema: 'serena-agent-pair/1', rows,
  limitations: ['one question, fixed arm order, not statistically significant', 'usage includes full Codex system/context overhead', 'cannot establish general task-success accuracy or net savings'] }, null, 2) + '\n');
if (!rows.every(r => r.correct && r.code === 0)) process.exitCode = 1;
