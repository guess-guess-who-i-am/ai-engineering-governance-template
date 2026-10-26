#!/usr/bin/env node
// Audit recorded execution, not assistant self-reports. Never export raw prompts.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export function auditRecords(records) {
  const routes = [], entryReads = [], mentions = [];
  let commands = 0;
  const seen = new Set();
  for (const row of records) {
    const p = row.payload || {}, item = p.item || {};
    if (p.role === 'developer') {
      const text = (p.content || []).map(c => c.text || '').join('\n');
      if (text.includes('[CODEX_SKILL_ROUTER')) routes.push({ at: row.timestamp,
        candidates: [...text.matchAll(/^- (.+?) \[([^;]+);/gm)].map(m => ({ name: m[1], kind: m[2] })) });
    }
    // Desktop terminal executions are arrays, not function_call arguments.
    if (p.type !== 'item_completed' || item.type !== 'CommandExecution') continue;
    const key = item.id || `${row.timestamp}:${JSON.stringify(item.command)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    commands++;
    const command = Array.isArray(item.command) ? item.command.join(' ') : String(item.command || '');
    const targets = [...command.matchAll(/[^\s"'`;|]+\/(?:resource-adapters\/[^\s"'`;|]+\/MODULE\.md|resource-packages\/expert\/[^\s"'`;|]+\/agents\/[^\s"'`;|]+\.md)/g)].map(m => m[0]);
    if (!targets.length) continue;
    // A grep/search/reference is not proof that the complete original role loaded.
    const readCommand = /(?:^|[\s;|])(?:cat|sed|head|tail|less|more)\s/.test(command);
    const loaded = /\[EXPERT_ENTRY_V1: ORIGINAL_ROLE_LOADED\]/.test(String(item.aggregated_output || ''));
    const evidence = { at: row.timestamp, targets: [...new Set(targets)], exitCode: item.exit_code,
      originalRoleMarker: loaded, completeRead: loaded && /(?:^|[\s;|])cat\s/.test(command) };
    (readCommand ? entryReads : mentions).push(evidence);
  }
  return { commands, routes, entryReads, referencesOnly: mentions,
    limitation: 'Visible desktop terminal completion events only. Missing events, external execution, unrecorded tools and compacted history cannot be ruled out. Reading is not execution completion.' };
}

async function files(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(e =>
    e.isDirectory() ? files(path.join(directory, e.name)) : [path.join(directory, e.name)]))).flat();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const id = process.argv[2];
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Expected a Codex thread UUID');
  const inputs = (await files(path.join(os.homedir(), '.codex/sessions'))).filter(f => path.basename(f).includes(id) && f.endsWith('.jsonl'));
  const rows = [];
  for (const file of inputs) {
    const records = (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    rows.push({ file: path.basename(file), ...auditRecords(records) });
  }
  const report = { threadId: id, files: rows.length, commands: rows.reduce((n, r) => n + r.commands, 0),
    routerInjections: rows.reduce((n, r) => n + r.routes.length, 0),
    recordedEntryReads: rows.reduce((n, r) => n + r.entryReads.length, 0), rows };
  const output = path.resolve('.reports', `thread-expert-use-${id}.json`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ ...report, rows: undefined, output }));
}
