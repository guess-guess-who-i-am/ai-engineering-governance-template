#!/usr/bin/env node
// Export complete, installed resource packages for the private library release.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const blocked = /^(?:\.git|node_modules|__pycache__|\.venv|venv|\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|id_(?:rsa|ed25519)(?:\.pub)?)$/i;
const blockedExtension = /\.(?:pem|key|p12|pfx)$/i;
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function walk(root) {
  const files = [], directories = [];
  async function visit(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, item.name), relative = path.relative(root, absolute).split(path.sep).join('/');
      if (blocked.test(item.name) || blockedExtension.test(item.name)) throw new Error(`Credential/cache path blocks export: ${relative}`);
      if (item.isSymbolicLink()) throw new Error(`Symlink blocks export: ${relative}`);
      if (item.isDirectory()) { directories.push(relative); await visit(absolute); }
      else if (item.isFile()) {
        const bytes = await readFile(absolute);
        files.push({ path: relative, bytes: bytes.length, sha256: sha(bytes) });
      } else throw new Error(`Unsupported filesystem entry: ${relative}`);
    }
  }
  await visit(root);
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), directories: directories.sort() };
}

export async function exportResourcePackages({ source = path.join(os.homedir(), '.codex/resource-packages'), output = process.cwd(), revision } = {}) {
  source = await import('node:fs/promises').then(fs => fs.realpath(source));
  output = path.resolve(output);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const inventory = await walk(source);
  const manifest = { schemaVersion: 'private-resource-packages/1', sourceRevision: revision || 'unrecorded', generatedAt: new Date().toISOString(), ...inventory };
  if (!manifest.files.length) throw new Error('No resource package files found');
  const manifestPath = path.join(output, 'resource-packages.manifest.json');
  const archivePath = path.join(output, 'resource-packages.tar.gz');
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await (await import('node:fs/promises')).writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  // Archive only the three complete source package classes. The generated manifest is a sidecar.
  await run('tar', ['-czf', archivePath, '-C', path.dirname(source), path.basename(source)]);
  const archive = await readFile(archivePath);
  const summary = { schemaVersion: manifest.schemaVersion, files: manifest.files.length, bytes: manifest.files.reduce((n, file) => n + file.bytes, 0), archiveBytes: archive.length,
    archiveSha256: sha(archive), manifestSha256: sha(manifestBytes), manifestPath, archivePath };
  const check = await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tzf', archivePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let listing = '', errors = '';
    child.stdout.on('data', chunk => { listing += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(listing) : reject(new Error(errors || `tar exited ${code}`)));
  });
  const entries = check.trim().split('\n').filter(Boolean);
  if (entries.length !== manifest.files.length + manifest.directories.length + 1 || entries.some(entry => !entry.startsWith('resource-packages/'))) throw new Error('Archive entry count or root mismatch');
  const result = { ...summary, archiveEntries: entries.length, verifiedListing: true };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  exportResourcePackages({ source: value('--source'), output: value('--output'), revision: value('--revision') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
