#!/usr/bin/env node
// Opt-in consumer check. Uses real global Hooks/graph and two temporary workspaces.
// No model request, credentials, project edits or third-party prompt export.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'ide-runtime': { type: 'string' }, output: { type: 'string' }
} });
assert(values['ide-runtime'], 'Pass --ide-runtime with the actual IDE server/agent-runtime.js');
const { createAgentRuntime } = await import(pathToFileURL(path.resolve(values['ide-runtime'])));
const homeDir = os.homedir(), codexHome = process.env.CODEX_HOME || path.join(homeDir, '.codex');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['desktop-task-workflow', 'skill-supply-chain-review'];
const manifest = JSON.parse(await readFile(path.join(codexHome, 'skill-registry/skills.graph.manifest.json')));
assert.equal(manifest.missingSkillCount, 0);
assert.equal(manifest.invalidSkillCount, 0);
const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-global-consumer-'));
try {
  const rows = await Promise.all([0, 1].map(async index => {
    const cwd = path.join(root, `workspace-${index}`);
    await mkdir(cwd);
    const runtime = await createAgentRuntime({ cwd, homeDir, codexHome,
      treeBridgeFactory: async () => ({ tools: [], instructions: '', close: async () => {} }) });
    const started = Date.now();
    try {
      const skills = [];
      for (const name of names) {
        const exact = path.join(homeDir, '.agents/skills', name, 'SKILL.md');
        const result = await runtime.call('skills_read', { name: exact });
        assert.equal(result.content, await readFile(exact, 'utf8'));
        assert(result.content.length > 500, 'Must read the complete body');
        skills.push({ name, sha256: digest(result.content), bytes: Buffer.byteLength(result.content) });
      }
      const prompt = index === 0 ? '请使用 $desktop-task-workflow 创建报告并交付文件'
        : '请使用 $skill-supply-chain-review 审查第三方 MCP 插件的供应链风险';
      const hook = await runtime.hooks('UserPromptSubmit', {
        prompt, session_id: `desktop-consumer-${process.pid}-${index}`, turn_id: '1'
      });
      assert.equal(hook.blocked, false);
      assert(hook.context.includes(names[index]), 'Global Hook must route the requested Skill');
      assert(hook.reports.every(report => report.ok), 'Every configured Hook must succeed');
      for (const report of hook.reports) assert(!/routing failed|startup failed|timed out/i.test(report.stderr || ''), report.stderr);
      return { workspace: index, started, ended: Date.now(), code: 0, skills,
        hookReports: hook.reports.map(({ ok, durationMs, contextSha256 }) => ({ ok, durationMs, contextSha256 })),
        promptSnapshot: { bytes: Buffer.byteLength(runtime.systemPrompt), sha256: digest(runtime.systemPrompt),
          sourceCount: runtime.instructionSources.length, hookSourceCount: runtime.hookSources.length } };
    } finally { await runtime.close(); }
  }));
  assert(rows[0].started < rows[1].ended && rows[1].started < rows[0].ended, 'Consumer checks must overlap');
  assert.deepEqual(rows[0].skills, rows[1].skills, 'Both workspaces must consume the same global Skills');
  const result = { status: 'PASS', modelQualityMeasured: false, waveWidth: 2, retries: 0,
    timeouts: 0, skipped: 0, graph: { skillCount: manifest.skillCount, ownedSkillCount: manifest.ownedSkillCount,
      resourceModuleCount: manifest.resourceModuleCount, mcpToolCount: manifest.mcpToolCount }, rows };
  if (values.output) {
    await mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
    await writeFile(values.output, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify(result));
} finally { await rm(root, { recursive: true, force: true }); }
