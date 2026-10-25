#!/usr/bin/env node
import { copyFile, rename, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const backup = path.resolve(process.argv[2]);
const root = path.join(os.homedir(), '.codex');
if (!backup.startsWith(path.join(root, 'backups/retrieval') + path.sep)) throw new Error('Expected an exact retrieval backup directory');
for (const name of ['graph_skill_index.py', 'refresh-skill-registry.mjs']) {
  await stat(path.join(backup, name));
  const dest = path.join(root, 'hooks', name), temp = dest + `.${process.pid}.tmp`;
  await copyFile(path.join(backup, name), temp); await rename(temp, dest);
}
for (const name of ['skills.graph.json', 'skills.graph.manifest.json', 'external-skills-manifest.json', 'skills-index.json', 'mcp-tools.json']) {
  const dest = path.join(root, 'skill-registry', name), temp = dest + `.${process.pid}.tmp`;
  await copyFile(path.join(backup, name), temp); await rename(temp, dest);
}
for (const name of ['external-library-config.json', 'routing-rules.json']) {
  try {
    await stat(path.join(backup, name));
    const dest = path.join(root, 'skill-registry', name), temp = dest + `.${process.pid}.tmp`;
    await copyFile(path.join(backup, name), temp); await rename(temp, dest);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
try {
  await stat(path.join(backup, 'skill-router.mjs'));
  const dest = path.join(root, 'hooks/skill-router.mjs'), temp = dest + `.${process.pid}.tmp`;
  await copyFile(path.join(backup, 'skill-router.mjs'), temp); await rename(temp, dest);
} catch (e) { if (e.code !== 'ENOENT') throw e; }
console.log('Previous global retrieval restored; Serena installation retained.');
