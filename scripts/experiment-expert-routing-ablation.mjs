#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codex = path.join(os.homedir(), '.codex');
const bundledNode = '/Users/pku1727/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node';
const graphPython = path.join(codex, 'tools/graph-tool-call-venv/bin/python');
const challengePath = path.join(root, 'scripts/resource-expert-routing-challenge.json');
const routerPath = path.join(codex, 'hooks/skill-router.mjs');
const graphPath = path.join(codex, 'skill-registry/skills.graph.json');
const indexerPath = path.join(codex, 'hooks/graph_skill_index.py');
const reportPath = path.join(root, '.reports/resource-integration/expert-routing-ablation.json');

for (const file of [bundledNode, graphPython, routerPath, graphPath, indexerPath]) {
  await readFile(file);
}
const challenge = JSON.parse(await readFile(challengePath, 'utf8'));
const registry = JSON.parse(await readFile(path.join(codex, 'skill-registry/skills-index.json'), 'utf8'));
const routingRules = await readFile(path.join(codex, 'skill-registry/routing-rules.json'));
const sourceRouter = await readFile(routerPath, 'utf8');
const lexicalLine = '...scored.filter(item => item.score >= minimum)';
if (!sourceRouter.includes(lexicalLine)) throw new Error('Expected local lexical supplement expression not found');
const aliasPromotion = 'exactName(query, item.skill.name) ||\n    (aliases[String(item.skill.name).toLocaleLowerCase()] || []).some(alias => query.includes(alias))';
if (!sourceRouter.includes(aliasPromotion)) throw new Error('Expected alias-promotion expression not found');

const digest = file => createHash('sha256').update(file).digest('hex');
const rows = [];
const temporary = await mkdtemp(path.join(os.tmpdir(), 'codex-expert-routing-ablation-'));
try {
  for (const mode of ['baseline', 'no-local-fill', 'no-alias-promotion', 'graph-only']) {
    const home = path.join(temporary, mode);
    const hooks = path.join(home, 'hooks');
    const registryDir = path.join(home, 'skill-registry');
    await mkdir(hooks, { recursive: true });
    await mkdir(registryDir, { recursive: true });
    await symlink(indexerPath, path.join(hooks, 'graph_skill_index.py'));
    await symlink(path.join(codex, 'resource-evidence'), path.join(home, 'resource-evidence'));
    await writeFile(path.join(registryDir, 'skills-index.json'), JSON.stringify({
      ...registry,
      externalGraphPath: graphPath,
    }));
    await writeFile(path.join(registryDir, 'routing-rules.json'), routingRules);
    let router = sourceRouter;
    if (mode === 'no-local-fill' || mode === 'graph-only') router = router.replace(lexicalLine, '...[]');
    if (mode === 'no-alias-promotion' || mode === 'graph-only') {
      router = router.replace(aliasPromotion, 'exactName(query, item.skill.name)');
    }
    const isolatedRouter = path.join(hooks, 'skill-router.mjs');
    await writeFile(isolatedRouter, router);

    for (const item of challenge.cases) {
      for (const language of ['zh', 'en']) {
        const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: item[language] });
        const began = performance.now();
        const result = spawnSync(bundledNode, [isolatedRouter], {
          input,
          cwd: temporary,
          encoding: 'utf8',
          env: { ...process.env, CODEX_HOME: home, CODEX_GRAPH_TOOL_PYTHON: graphPython },
          timeout: 65000,
        });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`${mode}/${item.id}/${language}: ${result.stderr}`);
        const body = JSON.parse(result.stdout || '{}');
        const context = body.hookSpecificOutput?.additionalContext || '';
        const names = [...context.matchAll(/^- (.+?) \[(?:Skill|Complete expert module|MCP\/[^;]+|MCP service module);/gm)]
          .map(match => match[1]);
        rows.push({
          mode,
          case: item.id,
          split: item.split,
          language,
          names,
          elapsedMs: Number((performance.now() - began).toFixed(2)),
          targetVisible: item.targets.some(target => names.some(name => name.toLowerCase() === target.toLowerCase())),
          contextReturned: Boolean(context),
          stderr: result.stderr.trim().slice(0, 300),
        });
      }
    }
  }

  const summarize = (mode, split) => {
    const selected = rows.filter(row => row.mode === mode && (!split || row.split === split));
    return {
      n: selected.length,
      targetVisible: selected.filter(row => row.targetVisible).length,
      emptyContext: selected.filter(row => !row.contextReturned).length,
      medianMs: selected.map(row => row.elapsedMs).sort((a,b) => a-b)[Math.floor(selected.length / 2)],
    };
  };
  const report = {
    schemaVersion: 'expert-routing-ablation/1',
    inputSha256: digest(await readFile(challengePath)),
    routerSha256: digest(await readFile(routerPath)),
    graphSha256: digest(await readFile(graphPath)),
    productionChanged: false,
    independentVariables: [
      'no-local-fill removes only the local lexical fallback from the final top-4.',
      'no-alias-promotion removes alias-based priority promotion but preserves exact-name promotion.',
      'graph-only applies both changes.',
      'All arms preserve the frozen queries, graph, worker and top-4 budget.',
    ],
    summaries: Object.fromEntries(['baseline', 'no-local-fill', 'no-alias-promotion', 'graph-only'].map(mode => [mode, {
      all: summarize(mode),
      experts: summarize(mode, 'expert-required'),
      boundedTools: summarize(mode, 'bounded-tool'),
    }])),
    rows,
    limitations: [
      'Small frozen challenge set; not an estimate of production-wide recall or precision.',
      'Target-name visibility is diagnostic; a substitute is only equivalent if its workflow and artifacts cover the requested task.',
      'Warm shared worker; elapsed times include process startup and should not be interpreted as a controlled latency comparison.',
      'No business MCP or expert workflows were executed; this measures routing visibility only.',
    ],
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summaries: report.summaries, report: reportPath, productionChanged: false }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
