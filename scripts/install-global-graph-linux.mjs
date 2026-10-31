#!/usr/bin/env node
// Preserve providers/trust; replace owned methodology only with an explicit flag.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, copyFile, rename, writeFile, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configure } from './configure-codex-concurrency.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '<!-- ai-engineering-governance-template:begin -->';
const END = '<!-- ai-engineering-governance-template:end -->';

export function unifiedAgents(current, canonical) {
  const desired = `${BEGIN}\n${canonical.trim()}\n${END}`;
  if (!current.trim()) return desired + '\n';
  const begin = current.indexOf(BEGIN), end = current.indexOf(END);
  if (begin < 0 || end < begin || current.indexOf(BEGIN, begin + BEGIN.length) >= 0) throw new Error('Unrecognized global AGENTS layout; refusing to replace unowned instructions');
  const body = current.slice(begin + BEGIN.length, end).trim();
  const prefix = current.slice(0, begin).trim();
  // One old installer duplicated exactly the managed body outside its markers.
  // Remove only that identical generated copy; preserve genuinely custom text.
  const before = prefix === body ? '' : prefix;
  return [before, desired, current.slice(end + END.length).trim()].filter(Boolean).join('\n\n') + '\n';
}

async function addMethodology(replacements, home) {
  const root = path.join(home, '.codex');
  const add = async (source, target) => replacements.set(target, await readFile(source, 'utf8'));
  const profile = path.join(repo, 'codex-profile');
  const prompts = path.join(profile, '.codex/prompts');
  for (const name of ['global-methodology-source.zh.md', 'global-attention-anchor.en.md', 'global-attention-anchor.zh.md', 'global-methodology-router.en.md', 'global-methodology-router.zh.md', 'global-every-turn.en.md', 'global-every-turn.zh.md', 'global-methodology-routing-review.zh.md', 'global-methodology-map.json']) {
    await add(path.join(prompts, name), path.join(root, 'prompts', name));
  }
  const publisher = path.join(profile, '.codex/prompt-publisher');
  for (const name of ['publish-methodology.mjs', 'publish-global-prompt.mjs', 'translation.schema.json', 'methodology-translation-cache.en.md', 'methodology-state.json', 'README.zh.md', 'test-methodology-publisher.mjs']) {
    await add(path.join(publisher, name), path.join(root, 'prompt-publisher', name));
  }
  const targets = JSON.parse(await readFile(path.join(publisher, 'methodology-targets.json'), 'utf8'));
  targets.validatorFile = '../hooks/validate-methodology-routing.mjs';
  targets.refreshRegistryFile = '../hooks/refresh-skill-registry.mjs';
  for (const route of targets.routes) if (route.skillFile) route.skillFile = `../../.agents/skills/${route.id}/SKILL.md`;
  replacements.set(path.join(root, 'prompt-publisher/methodology-targets.json'), JSON.stringify(targets, null, 2) + '\n');
  const agentsFile = path.join(root, 'AGENTS.md');
  const currentAgents = await readFile(agentsFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  replacements.set(agentsFile, unifiedAgents(currentAgents, await readFile(path.join(profile, '.codex/AGENTS.md'), 'utf8')));
  await add(path.join(profile, 'mac/hooks/context-refresh.mjs'), path.join(root, 'hooks/context-refresh.mjs'));
  await add(path.join(profile, 'mac/hooks/validate-methodology-routing.mjs'), path.join(root, 'hooks/validate-methodology-routing.mjs'));
  await add(path.join(repo, 'scripts/parallel-run.mjs'), path.join(root, 'tools/parallel-run.mjs'));
  async function skillTree(source, target) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || /\.py[co]$/.test(entry.name)) continue;
      if (entry.isDirectory()) await skillTree(path.join(source, entry.name), path.join(target, entry.name));
      else if (entry.isFile()) await add(path.join(source, entry.name), path.join(target, entry.name));
      else throw new Error('Unexpected link in owned Skill source: ' + path.join(source, entry.name));
    }
  }
  const owned = path.join(profile, 'global-skills');
  for (const entry of await readdir(owned, { withFileTypes: true })) if (entry.isDirectory()) {
    await skillTree(path.join(owned, entry.name), path.join(home, '.agents/skills', entry.name));
  }
}
export function linuxContext(current, canonical) {
  if (current.includes('const CADENCE = 3;')) return current;
  const helpers = canonical.slice(canonical.indexOf('const CADENCE = 3;'), canonical.indexOf('function findProjectFile('));
  if (!helpers || !current.includes('const parts = [];')) throw new Error('Unknown context-refresh layout; refusing overwrite');
  return current.replace('import { readFile } from "node:fs/promises";',
    'import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";\nimport { createHash, randomUUID } from "node:crypto";')
    .replace('const batchingContract =', helpers + '\nconst batchingContract =')
    .replace('const parts = [];', 'const parts = [];\n  if (!await includeFixedContext(codexRoot, input, eventName)) { process.stdout.write("{}"); process.exit(0); }');
}

export function linuxMcpPreset(current, home) {
  let active = false;
  return current.split('\n').map(line => {
    if (/^\s*\[/.test(line)) active = /^\s*\[mcp_servers\.task_tree\]\s*$/.test(line);
    if (!active) return line;
    if (/^command\s*=/.test(line)) return `command = ${JSON.stringify(path.join(home, '.local/bin/node'))}`;
    if (/^args\s*=/.test(line)) return `args = [${JSON.stringify(path.join(home, '.codex/tools/llm-task-tree-kit/scripts/mcp-server.mjs'))}]`;
    return line;
  }).join('\n');
}

const quote = value => '"' + value.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
export function serviceText(home, processes) {
  if (!Number.isInteger(processes) || processes < 1 || processes > 20) throw new Error('processes must be 1-20');
  const root = path.join(home, '.codex');
  const graph = path.join(root, 'skill-registry/skills.graph.json');
  const socket = `/tmp/codex-graph-${process.getuid()}/${createHash('sha256').update(graph).digest('hex').slice(0, 24)}.sock`;
  const python = path.join(root, 'tools/graph-tool-call-venv/bin/python');
  // Eight-process hot reload exceeded the old 16GiB soft cap and stalled in
  // reclaim despite free host RAM. Reserve 2GiB below the unchanged hard cap.
  return `[Unit]\nDescription=Global Codex GraphToolCall CPU worker\nStartLimitIntervalSec=0\n\n[Service]\nType=simple\nUMask=0077\nEnvironment=HF_HUB_OFFLINE=1\nEnvironment=TRANSFORMERS_OFFLINE=1\nEnvironment=TOKENIZERS_PARALLELISM=false\nEnvironment=OMP_NUM_THREADS=1\nEnvironment=OPENBLAS_NUM_THREADS=1\nEnvironment=MKL_NUM_THREADS=1\nExecStart=${[python, path.join(root, 'hooks/graph_skill_index.py'), 'serve', '--graph', graph, '--socket', socket, '--processes', String(processes)].map(quote).join(' ')}\nExecStartPost=${[python, path.join(root, 'hooks/warm-global-graph.py'), '--graph', graph, '--processes', String(processes)].map(quote).join(' ')}\nRestart=always\nRestartSec=3\nTimeoutStartSec=180\nTimeoutStopSec=70\nCPUQuota=${processes * 100}%\nMemoryHigh=${Math.max(4, processes * 3 - 2)}G\nMemoryMax=${Math.max(6, processes * 3)}G\nTasksMax=512\n\n[Install]\nWantedBy=default.target\n`;
}

export async function install({ home, processes = 8, apply = false, unifyMethodology = false }) {
  // Validate before touching any hook. The helper leaves all unrelated keys intact.
  await configure({ home, apply: false, width: 20 });
  const root = path.join(home, '.codex');
  const replacements = new Map();
  for (const [source, target] of [
    ['codex-profile/mac/hooks/graph_skill_index.py', 'hooks/graph_skill_index.py'],
    ['codex-profile/mac/hooks/refresh-skill-registry.mjs', 'hooks/refresh-skill-registry.mjs'],
    ['codex-profile/.codex/hooks/skill-router.mjs', 'hooks/skill-router.mjs'],
    ['scripts/warm-global-graph.py', 'hooks/warm-global-graph.py']]) {
    replacements.set(path.join(root, target), await readFile(path.join(repo, source), 'utf8'));
  }
  const dispatchPath = path.join(root, 'hooks/hook-dispatch.mjs');
  const dispatch = await readFile(dispatchPath, 'utf8');
  if (!dispatch.includes('own("skill-router", 12000)') && !dispatch.includes('own("skill-router", 60000)')) throw new Error('Unknown dispatcher layout');
  replacements.set(dispatchPath, dispatch.replace('own("skill-router", 12000)', 'own("skill-router", 60000)'));
  const contextPath = path.join(root, 'hooks/context-refresh.mjs');
  replacements.set(contextPath, linuxContext(await readFile(contextPath, 'utf8'), await readFile(path.join(repo, 'codex-profile/mac/hooks/context-refresh.mjs'), 'utf8')));
  const hooksPath = path.join(root, 'hooks.json');
  const hooks = JSON.parse(await readFile(hooksPath, 'utf8'));
  for (const group of hooks.hooks?.UserPromptSubmit || []) for (const hook of group.hooks || []) {
    if (hook.command?.includes('hook-dispatch.mjs')) hook.timeout = 65;
  }
  replacements.set(hooksPath, JSON.stringify(hooks, null, 2) + '\n');
  const rulesPath = path.join(root, 'skill-registry/routing-rules.json');
  const rules = JSON.parse(await readFile(rulesPath, 'utf8'));
  const baseline = JSON.parse(await readFile(path.join(repo, 'codex-profile/.codex/skill-registry/routing-rules.json'), 'utf8'));
  replacements.set(rulesPath, JSON.stringify({ ...baseline, ...rules }, null, 2) + '\n');
  replacements.set(path.join(root, 'skill-registry/external-library-config.json'), JSON.stringify({ root: path.join(root, 'tools/skills'), catalog: path.join(root, 'tools/skills/_catalog_cn.json'), requireComplete: true }, null, 2) + '\n');
  replacements.set(path.join(home, '.config/systemd/user/codex-graph-worker.service'), serviceText(home, processes));
  if (existsSync(path.join(root, 'tools/llm-task-tree-kit/scripts/mcp-server.mjs'))) {
    for (const name of ['task-tree.config.toml', 'full-tools.config.toml']) {
      const file = path.join(root, name);
      if (existsSync(file)) replacements.set(file, linuxMcpPreset(await readFile(file, 'utf8'), home));
    }
  }
  if (unifyMethodology) await addMethodology(replacements, home);
  const changes = [];
  const backup = path.join(root, 'backups', 'global-graph-' + new Date().toISOString().replaceAll(':', '-'));
  for (const [file, body] of replacements) {
    let current;
    try { if ((await lstat(file)).isSymbolicLink()) throw new Error('Refusing symlink target: ' + file); current = await readFile(file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === body) continue;
    changes.push(path.relative(home, file));
    if (!apply) continue;
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    if (current !== undefined) {
      const dest = path.join(backup, path.relative(home, file));
      await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 }); await copyFile(file, dest);
      if (unifyMethodology && file === path.join(root, 'prompts/global-methodology-source.zh.md')) {
        const sourceBackups = path.join(root, 'prompts/backups/methodology-source');
        await mkdir(sourceBackups, { recursive: true, mode: 0o700 });
        await copyFile(file, path.join(sourceBackups, path.basename(backup) + '.zh.md'));
      }
    }
    const temp = file + '.' + process.pid + '.tmp';
    await writeFile(temp, body, { mode: 0o600 });
    await rename(temp, file);
  }
  const concurrency = await configure({ home, apply, width: 20 });
  return { applied: apply, unifyMethodology, changes, backup: apply && changes.length ? backup : undefined, concurrency,
    activation: 'Build registry, then systemctl --user daemon-reload and enable --now codex-graph-worker. Hook trust must use Codex approval UI; no trust records are altered.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  if (process.platform !== 'linux') throw new Error('Linux only');
  console.log(JSON.stringify(await install({ home: value('--home') || os.homedir(), processes: Number(value('--processes') || 8), apply: args.includes('--apply'), unifyMethodology: args.includes('--unify-methodology') }), null, 2));
}
