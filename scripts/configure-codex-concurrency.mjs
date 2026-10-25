#!/usr/bin/env node
// A narrow repair: never replace providers, Hooks, credentials, or other features.
import { chmod, copyFile, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function concurrencyConfig(source, width = 20) {
  if (!Number.isInteger(width) || width < 1 || width > 20) throw new Error('Thread limit must be an integer from 1 to 20');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const changes = [];
  for (const [section, entries] of [
    ['features', { multi_agent: 'true' }],
    ['agents', { enabled: 'true', max_concurrent_threads_per_session: String(width) }]
  ]) {
    const headers = lines.flatMap((line, i) => new RegExp(`^\\s*\\[${section}\\]\\s*(?:#.*)?$`).test(line) ? [i] : []);
    if (headers.length > 1) throw new Error(`Duplicate [${section}] section; refusing ambiguous configuration`);
    if (!headers.length) {
      if (lines.at(-1)?.trim()) lines.push('');
      lines.push(`[${section}]`);
    }
    const start = headers[0] ?? lines.length - 1;
    let end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
    if (end < 0) end = lines.length;
    for (const [key, value] of Object.entries(entries)) {
      const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(true|false|[0-9]+)\\s*(#.*)?$`);
      const candidates = lines.flatMap((line, i) => i > start && i < end && new RegExp(`^\\s*${key}\\s*=`).test(line) ? [i] : []);
      if (candidates.length > 1) throw new Error(`Duplicate ${section}.${key}; refusing ambiguous configuration`);
      if (candidates.length) {
        const i = candidates[0], match = lines[i].match(pattern);
        if (!match) throw new Error(`Unexpected ${section}.${key} value; manual review required`);
        if (match[1] === value) continue;
        changes.push({ key: `${section}.${key}`, before: match[1], after: value });
        lines[i] = `${key} = ${value}${match[2] ? ` ${match[2]}` : ''}`;
      } else {
        changes.push({ key: `${section}.${key}`, before: 'absent', after: value });
        lines.splice(end++, 0, `${key} = ${value}`);
      }
    }
  }
  return { text: changes.length ? lines.join(newline).replace(/(?:\r?\n)*$/, newline) : source, changes };
}

export async function configure({ home = os.homedir(), apply = false, width = 20 } = {}) {
  const file = path.join(path.resolve(home), '.codex', 'config.toml');
  if (!(await lstat(file)).isFile()) throw new Error('config.toml must be a regular file, not a symbolic link');
  const lockPath = `${file}.concurrency.lock`;
  const lock = apply ? await open(lockPath, 'wx', 0o600) : null;
  let temporary;
  try {
    const original = await readFile(file, 'utf8');
    const plan = concurrencyConfig(original, width);
    const result = { status: plan.changes.length ? (apply ? 'configured' : 'changes-required') : 'current', changes: plan.changes };
    if (!apply || !plan.changes.length) return result;
    const backup = `${file}.before-concurrency-${randomUUID()}`;
    await copyFile(file, backup);
    await chmod(backup, 0o600);
    // Refuse to replace settings edited by another process during planning.
    if (await readFile(file, 'utf8') !== original) throw new Error('config.toml changed concurrently; refusing to overwrite it');
    temporary = `${file}.concurrency-${randomUUID()}.tmp`;
    const output = await open(temporary, 'wx', 0o600);
    try { await output.writeFile(plan.text); await output.sync(); } finally { await output.close(); }
    if (await readFile(file, 'utf8') !== original) throw new Error('config.toml changed concurrently; refusing to overwrite it');
    await rename(temporary, file);
    temporary = undefined;
    return { ...result, backup, restartRequired: true, hookTrustChanged: false };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    if (lock) { await lock.close(); await unlink(lockPath); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--home') { options.home = process.argv[++i]; if (!options.home) throw new Error('--home needs a path'); }
    else if (arg === '--max-threads') options.width = Number(process.argv[++i]);
    else if (arg === '--apply') options.apply = true;
    else if (arg !== '--check') throw new Error(`Unknown argument: ${arg}`);
  }
  configure(options).then(result => {
    console.log(JSON.stringify(result));
    if (result.status === 'changes-required') process.exitCode = 2;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
