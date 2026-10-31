#!/usr/bin/env node
// Service-manager child. Never starts a model Agent or reads authentication.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const graph = path.join(root, 'skill-registry/skills.graph.json');
const processes = Number(process.argv[process.argv.indexOf('--processes') + 1]);
if (!Number.isInteger(processes) || processes < 1 || processes > 20) throw new Error('Invalid worker width');
const socket = process.platform === 'win32' ? graph + '.worker.json'
  : `/tmp/codex-graph-${process.getuid()}/${createHash('sha256').update(graph).digest('hex').slice(0, 24)}.sock`;
const python = path.join(root, 'tools/graph-tool-call-venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
const env = { ...process.env, CODEX_HOME: root, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false',
  OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' };
await mkdir(path.join(root, 'skill-registry'), { recursive: true, mode: 0o700 });
const log = await open(path.join(root, 'skill-registry/worker.log'), 'a', 0o600);
let stopping = false, child;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child?.kill(); });
while (!stopping) {
  child = spawn(python, [path.join(root, 'hooks/graph_skill_index.py'), 'serve', '--graph', graph, '--socket', socket, '--processes', String(processes)],
    { env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  child.on('error', error => log.write(`${new Date().toISOString()} worker launch failed: ${error.code}\n`));
  const warm = spawn(python, [path.join(root, 'hooks/warm-global-graph.py'), '--graph', graph, '--processes', String(processes)],
    { env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  warm.on('error', error => log.write(`warmup launch failed: ${error.code}\n`));
  await new Promise(resolve => { child.once('close', resolve); child.once('error', resolve); });
  warm.kill();
  if (!stopping) await new Promise(resolve => setTimeout(resolve, 3000));
}
await log.close();
