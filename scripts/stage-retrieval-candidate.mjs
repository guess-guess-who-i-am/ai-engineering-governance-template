#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configuredServers, discover } from '../codex-profile/mac/hooks/mcp-catalog.mjs';
const root = path.join(os.homedir(), '.codex');
const python = path.join(root, 'tools/graph-tool-call-venv/bin/python');
const stage = path.resolve('.reports/retrieval-candidate');
await mkdir(path.join(stage, 'skill-registry'), { recursive: true });
const servers = await configuredServers(path.join(root, 'config.toml'), python);
const tools = (await Promise.all(servers.map(s => discover(s)))).flat();
const catalog = path.join(stage, 'mcp-tools.json');
await writeFile(catalog, JSON.stringify({ tools }));
const graph = path.join(stage, 'skill-registry/skills.graph.json');
await new Promise((resolve, reject) => {
  const child = spawn(python, [path.resolve('codex-profile/mac/hooks/graph_skill_index.py'), 'build', '--root', path.join(root, 'tools/skills'),
    '--catalog', path.join(root, 'tools/skills/_catalog_cn.json'), '--output', graph, '--mcp-catalog', catalog,
    '--owned-root', path.join(os.homedir(), '.agents/skills'), '--embedding',
    ...(process.argv.includes('--multilingual') ? ['--chinese-embedding', 'paraphrase-multilingual-MiniLM-L12-v2'] : [])], { env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
      OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4', TOKENIZERS_PARALLELISM: 'false' }, stdio: 'inherit' });
  child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`Candidate build failed: ${code}`)));
});
await writeFile(path.join(stage, 'skill-registry/skills-index.json'), JSON.stringify({ externalGraphPath: graph }));
console.log(JSON.stringify({ stage, graph, mcpTools: tools.length }));
