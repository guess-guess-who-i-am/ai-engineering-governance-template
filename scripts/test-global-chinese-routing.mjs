import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = path.join(os.homedir(), '.codex');
const cases = [
  ['debug', '分析软件测试失败，沿信息流找首次偏离，先验证根因假设再改代码。', 'systematic-debugging', process.cwd()],
  ['engineering', '先检查项目和测试，再实现代码变更并运行针对性验证。', 'method-engineering-execution', process.cwd()],
  ['other-workspace', '分析软件测试失败，沿信息流找首次偏离，先验证根因假设再改代码。', 'systematic-debugging', os.tmpdir()],
];
const rows = await Promise.all(cases.map(([name, prompt, expected, cwd]) => new Promise(resolve => {
  const begun = performance.now();
  const child = spawn(process.execPath, [path.join(root, 'hooks/hook-dispatch.mjs')], {
    env: {...process.env, CODEX_HOME:root}, stdio:['pipe','pipe','pipe']
  });
  let output = '', error = '', timedOut = false;
  const timer = setTimeout(() => {timedOut=true; child.kill();}, 65000);
  child.stdout.on('data', c => {output += c;}); child.stderr.on('data', c => {error += c;});
  child.on('close', code => {
    clearTimeout(timer);
    let context = '';
    try {context = JSON.parse(output).hookSpecificOutput.additionalContext;} catch { /* contract failure */ }
    resolve({name, expected, correct:code===0 && context.includes(expected) && !context.includes('navigate-code-with-serena') && !context.includes('mcp_serena_') && !/routing failed/i.test(error),
      routerPresent:context.includes('CODEX_SKILL_ROUTER_V2'), contextBytes:Buffer.byteLength(context),
      seconds:(performance.now()-begun)/1000, timedOut});
  });
  child.stdin.end(JSON.stringify({hook_event_name:'UserPromptSubmit', prompt:prompt + `（独立验证编号：${process.pid}-${name}）`, cwd,
    session_id:'chinese-global-e2e-' + name + '-' + process.pid, turn_id:'1'}));
})));
await writeFile('.reports/global-chinese-routing-without-serena.json', JSON.stringify({schema:'global-chinese-hook-e2e/1',rows},null,2)+'\n');
console.log(JSON.stringify(rows));
assert.ok(rows.every(r=>r.correct && r.routerPresent));
