#!/usr/bin/env node
// One read loads the original primary role. No tool translation or source edits.
import { createHash } from 'node:crypto';
import { readFile, realpath, readdir, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => file.startsWith(root + path.sep);

export function blockedExpertEntry(module, error) {
  const reason = error instanceof SyntaxError ? 'Original plugin manifest is invalid JSON' : error.message;
  return { state: 'blocked', reason, bytes: Buffer.from(`# Complete expert module: ${module.name}\n\n[EXPERT_ENTRY_V1: BLOCKED]\n${reason}\n\nNo role has been loaded or executed. Report this blocker; do not guess a member, translate tools, or claim completion. The original package is unchanged.\n`) };
}

async function contained(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('Expected a package-relative entry');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('Entry escapes the original package');
  const resolved = await realpath(target);
  if (!inside(root, resolved)) throw new Error('Entry symlink escapes the original package');
  return resolved;
}

export async function buildExpertEntry(module) {
  if (module.kind !== 'expert') throw new Error('Expected a complete expert module');
  const root = await realpath(module.package_root);
  let manifest;
  for (const directory of ['.codebuddy-plugin', '.workbuddy-plugin']) {
    let file;
    try { file = await contained(root, directory + '/plugin.json'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    // A malformed existing manifest must not silently fall through to another.
    manifest = JSON.parse(await readFile(file, 'utf8'));
    break;
  }
  if (!manifest) throw new Error('Original plugin manifest is missing');
  let roles = [];
  if (Array.isArray(manifest.agents)) {
    if (manifest.agents.some(role => typeof role !== 'string')) throw new Error('Unsupported original agents declaration');
    roles = manifest.agents;
  } else {
    const relative = manifest.agents || 'agents';
    const location = await contained(root, relative);
    if (location.endsWith('.md')) roles = [relative];
    else roles = (await readdir(location, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => path.join(relative, entry.name));
  }
  roles = [...new Set(roles)];
  const declaredLead = manifest.teamInfo?.leadAgent || manifest.agentName;
  const named = declaredLead || module.name;
  if (typeof named !== 'string') throw new Error('Unsupported original lead declaration');
  const matches = roles.filter(role => named.includes('/') || named.includes('\\')
    ? path.normalize(role) === path.normalize(named)
    : path.basename(role, '.md') === named.replace(/\.md$/, ''));
  const primary = matches.length === 1 ? matches[0] : !declaredLead && roles.length === 1 ? roles[0] : undefined;
  if (!primary) throw new Error('No unambiguous original primary role; do not choose an arbitrary member');
  if (!primary.endsWith('.md')) throw new Error('Original primary role must be Markdown');
  const originalPath = await contained(root, primary);
  const original = await readFile(originalPath);
  if (!original.length || !original.toString('utf8').trim()) throw new Error('Original primary role is empty');
  const primarySha256 = hash(original);
  // Leave original bytes, including front matter, CRLF and BOM, untouched.
  const prefix = Buffer.from(`# Complete expert module: ${module.name}\n\n[EXPERT_ENTRY_V1: ORIGINAL_ROLE_LOADED]\nPackage root: ${root}\nOriginal primary role: ${originalPath}\nOriginal role SHA-256: ${primarySha256}\n\nRead this entire entry: the complete original primary role is included below. Execute that role for the current task; do not read it a second time or substitute a generic workflow. Resolve package-relative roles, internal Skills and attachments from the package root, loading them only when the original workflow calls for them. Task code, deliverables and commands stay in the user's workspace unless explicitly specified otherwise; do not move the task into the resource library. Keep the original content and organization.\n\nUse original tools and scripts only when actually available and authorized. Do not translate tool names, invent a host adapter, or substitute another orchestration workflow. If a required tool is unavailable, report its exact name and the blocked step; do not claim execution. Higher-priority instructions, safety and the user's scope still apply.\n\nBriefly tell the user which complete expert is being used. Loading is not completion: report the actual deliverable and verification, or the blocker. An original PASS assertion or exhausted budget is not evidence of success.\n\n## Original primary role — verbatim from this point to EOF\n\n`);
  return { bytes: Buffer.concat([prefix, original]), originalPath, primarySha256, originalBytes: original.length };
}

export async function refreshExpertEntries({ codexRoot = path.join(os.homedir(), '.codex'), install = false } = {}) {
  codexRoot = await realpath(codexRoot);
  const catalogBytes = await readFile(path.join(codexRoot, 'skill-registry/resource-modules.json'));
  const experts = JSON.parse(catalogBytes).modules.filter(module => module.kind === 'expert');
  const adapterRoot = await realpath(path.join(codexRoot, 'resource-adapters'));
  const packageRoot = await realpath(path.join(codexRoot, 'resource-packages/expert'));
  const targets = new Set();
  const prepared = new Array(experts.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(20, experts.length) }, async () => {
    while (cursor < experts.length) {
      const index = cursor++, module = experts[index];
      const directory = await realpath(path.dirname(path.resolve(module.path)));
      const target = path.join(directory, path.basename(module.path));
      if (!inside(adapterRoot, target) || path.basename(target) !== 'MODULE.md' || targets.has(target))
        throw new Error('Invalid or duplicate external entry path');
      targets.add(target);
      // Do not write through a redirected adapter directory or package root.
      if (!inside(adapterRoot, directory))
        throw new Error('External entry directory escapes global adapters');
      if (!inside(packageRoot, await realpath(module.package_root)))
        throw new Error('Expert package escapes global expert library');
      let entry;
      try { entry = { ...await buildExpertEntry(module), state: 'original-role-loaded' }; }
      catch (error) {
        // Replace an obsolete mapping with an honest blocked entry, not a guess.
        entry = blockedExpertEntry(module, error);
      }
      const before = await readFile(target);
      prepared[index] = { module, target, entry, changed: !before.equals(entry.bytes) };
    }
  }));
  // Validate everything before touching any generated entry. The catalog is immutable.
  if (!(await readFile(path.join(codexRoot, 'skill-registry/resource-modules.json'))).equals(catalogBytes))
    throw new Error('Catalog changed during entry preparation');
  for (const { target, entry, changed } of prepared) if (install && changed) {
    const temporary = target + `.${process.pid}.tmp`;
    try { await writeFile(temporary, entry.bytes, { mode: 0o600 }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { schemaVersion: 'expert-direct-entry/1', installed: install, experts: experts.length,
    ready: prepared.filter(row => row.entry.state === 'original-role-loaded').length,
    blocked: prepared.filter(row => row.entry.state === 'blocked').length,
    changed: prepared.filter(row => row.changed).length,
    catalogSha256: hash(catalogBytes), originalPackagesWritten: false,
    rows: prepared.map(({ module, entry, changed }) => ({ id: module.id, path: module.path, state: entry.state,
      primarySha256: entry.primarySha256, originalBytes: entry.originalBytes, reason: entry.reason, changed })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  try {
    const result = await refreshExpertEntries({ codexRoot: value('--codex-root'), install: args.includes('--install') });
    const report = value('--report');
    if (report) { await mkdir(path.dirname(path.resolve(report)), { recursive: true }); await writeFile(report, JSON.stringify(result, null, 2) + '\n'); }
    console.log(JSON.stringify({ ...result, rows: undefined }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
