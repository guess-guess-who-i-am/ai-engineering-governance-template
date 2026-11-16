import { createHash } from 'node:crypto';
import { mkdir, writeFile, rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
const EVENTS = new Set(['PreToolUse', 'PostToolUse']);
const sensitive = /\b(?:sk-[a-z0-9_-]{12,}|(?:api[_-]?key|token|password|authorization)\s*[:=])|[?&](?:token|key)=|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:--password|--token|--api-key)\b/i;
function safe(value) {
  if (typeof value !== 'string' || sensitive.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 1800);
}

function scope(codexRoot, input) {
  if (!input.session_id || !input.turn_id || !input.cwd) return null;
  return path.join(codexRoot, 'hooks', 'routing-checkpoints', digest(JSON.stringify([
    input.session_id, input.turn_id, input.agent_id || '', path.resolve(input.cwd)
  ])));
}

function failed(response) {
  if (!response || typeof response !== 'object') return false;
  if (response.isError === true || response.is_error === true || response.success === false || response.ok === false || response.timedOut === true) return true;
  if (['exit_code', 'exitCode', 'code'].some(k => typeof response[k] === 'number' && response[k] !== 0)) return true;
  // Only structured status is examined. Tool output text is untrusted data
  // and never becomes retrieval text or instructions.
  return ['metadata', 'result', 'structuredContent'].some(k => failed(response[k]));
}

export function toolRoutingSignal(input) {
  if (!EVENTS.has(input.hook_event_name) || !scope('.', input)) return null;
  const tool = String(input.tool_name || '');
  const args = input.tool_input || {};
  const raw = ['title', 'description', 'query', 'prompt', 'cmd', 'command', 'code', 'path', 'file_path', 'url']
    .map(key => safe(args[key])).filter(Boolean).join('\n').slice(0, 2200);
  if (/skill-router\.mjs|hook-dispatch\.mjs|routing-checkpoint\.mjs/.test(raw)) return null;
  const post = input.hook_event_name === 'PostToolUse';
  const failure = post && failed(input.tool_response);
  // Codex 0.169 sends only shell stdout, losing the exit code. Do not infer
  // success/failure from that text: schedule one outcome review per capability.
  const unknownOutcome = post && typeof input.tool_response === 'string';
  if (post && !failure && !unknownOutcome) return null;
  const text = `${tool} ${raw}`.toLowerCase();
  const stages = [
    ['test', /\b(?:test|pytest|unittest|vitest|jest|verify|benchmark)\b|测试|验证|评测/],
    ['debug', /\b(?:debug|diagnos\w*|traceback|regression)\b|根因|排查|诊断/],
    ['research', /\b(?:search|research|stackoverflow|openalex|crossref)\b|搜索|论文|检索/],
    ['install', /\b(?:install|dependency|dependencies|pip|uv add|npm (?:add|i))\b|安装|依赖/],
    ['deliver', /\b(?:deploy|publish|release|git (?:commit|push)|gh pr)\b|部署|发布|提交/],
    ['edit', /\b(?:apply_patch|write_file|edit|refactor|implement)\b|修改|实现|重构/]
  ].filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  const artifacts = [...new Set([...text.matchAll(/\.((?:py|rs|go|java|cpp|c|h|ts|tsx|js|jsx|mjs|sql|sh|ps1|md|json|yaml|yml|toml|html|css|pdf|docx|pptx|xlsx|csv))\b/g)].map(m => m[1]))].sort();
  // Tool family + action + artifact kind detects capability changes without
  // hashing every changed filename/argument into a new expensive lookup.
  const commands = ['cmd', 'command', 'code'].map(key => safe(args[key])).filter(Boolean).join('\n').toLowerCase();
  const programs = [...new Set([...commands.matchAll(/(?:^|[\n;&|]|\b(?:await|tools)\s*\.?\s*)\s*([a-z][a-z0-9_-]{1,})\b/g)]
    .map(match => match[1]).filter(name => !['cat', 'rg', 'ls', 'sed', 'head', 'tail', 'const', 'let', 'text'].includes(name)))].sort().slice(0, 12);
  const key = JSON.stringify([tool, stages, artifacts, programs, failure ? 'failure' : unknownOutcome ? 'outcome' : 'action']);
  const purpose = failure ? 'Diagnose and fix a failed operation. ' : unknownOutcome
    ? 'Review the current operation and recommend specialist workflows for verification or troubleshooting if needed. Exit status is unavailable; no failure is established. '
    : 'Find workflows for the current operation. ';
  const query = `${purpose}Tool: ${tool.slice(0, 160)}. Phase: ${stages.join(', ') || 'inspect'}. Artifacts: ${artifacts.join(', ') || 'unspecified'}.\n${raw}`.slice(0, 2400);
  return { key, query };
}

export async function claimCheckpoint(codexRoot, input, key) {
  const directory = scope(codexRoot, input);
  if (!directory) return null;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, `query-${digest(key)}`);
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Successful receipts remain for the turn. Interrupted owners expire
    // beyond the router's 60-second deadline, allowing the next tool to retry.
    const done = await stat(path.join(lock, 'done')).then(() => true, error => {
      if (error.code === 'ENOENT') return false; throw error;
    });
    const age = await stat(lock).then(info => Date.now() - info.mtimeMs, () => 0);
    if (done || age < 90000) return null;
    await rm(lock, { recursive: true, force: true });
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') return null; throw error; }
  }
  return lock;
}

export async function finishCheckpoint(claim, success) {
  if (!claim) return;
  if (success) await writeFile(path.join(claim, 'done'), '', { mode: 0o600 });
  else await rm(claim, { recursive: true, force: true });
}

export async function novelCandidates(codexRoot, input, candidates) {
  const directory = scope(codexRoot, input);
  if (!directory) return candidates;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const result = [];
  for (const candidate of candidates) {
    const skill = candidate.skill;
    const key = JSON.stringify([skill.kind || 'skill', skill.mcpServer || '', skill.moduleId || skill.path || '', skill.name]);
    try { await mkdir(path.join(directory, `entry-${digest(key)}`), { mode: 0o700 }); result.push(candidate); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return result;
}

export async function rememberCandidates(codexRoot, input, candidates) {
  await novelCandidates(codexRoot, input, candidates);
}

export async function pruneCheckpoints(codexRoot) {
  const root = path.join(codexRoot, 'hooks', 'routing-checkpoints');
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  // SessionStart only; no directory scan on each tool event. State contains
  // hashes and empty receipts, never prompts, tool output or credentials.
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    const age = await stat(directory).then(info => Date.now() - info.mtimeMs, () => 0);
    if (age > 7 * 86400000) await rm(directory, { recursive: true, force: true });
  }
}
