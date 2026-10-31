#!/usr/bin/env node
// Retire only the Serena integration previously installed by this profile.
import { lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function retireSerena({ home = os.homedir(), check = false } = {}) {
  home = path.resolve(home);
  const root = path.join(home, '.codex');
  const operations = [];
  const optional = async file => {
    try { return await readFile(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  async function replace(file, bytes) {
    const before = await optional(file);
    if (before?.equals(bytes)) return;
    const info = await lstat(file);
    if (!info.isFile()) throw new Error('Unexpected file identity; preserving ' + path.relative(home, file));
    operations.push({ file, bytes, mode: info.mode & 0o777 });
  }
  async function emptyTree(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !await emptyTree(path.join(directory, entry.name))) return false;
    }
    return true;
  }
  async function remove(relative, identityFile, matches, label = 'file') {
    const file = path.join(home, relative);
    let info;
    try { info = await lstat(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    // Do not follow links into unrelated user data during destructive migration.
    if (info.isSymbolicLink()) throw new Error('Unexpected ' + label + ' identity; preserving ' + relative);
    if (info.isDirectory() && await emptyTree(file)) {
      operations.push({ file, remove: true });
      return;
    }
    const identity = await optional(path.join(file, ...(identityFile ? [identityFile] : [])));
    if (!identity || !matches(identity.toString())) throw new Error('Unexpected ' + label + ' identity; preserving ' + relative);
    operations.push({ file, remove: true });
  }
  const configPath = path.join(root, 'config.toml');
  const configBytes = await optional(configPath);
  if (configBytes) {
    const config = configBytes.toString();
    // Match actual table headers, not an indented multiline args array.
    const sections = [...config.matchAll(/^[ \t]*\[\[?((?:[^\]\r\n"'#]|"(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')+)\]\]?[ \t]*(?:#.*)?\r?$/gm)];
    const identity = /^(?:mcp_servers|"mcp_servers"|'mcp_servers')[ \t]*\.[ \t]*(?:serena|"serena"|'serena')([ \t]*\..+)?$/;
    const managed = sections.some((section, index) => {
      const match = identity.exec(section[1].trim());
      if (!match || match[1]) return false;
      const block = config.slice(section.index + section[0].length, sections[index + 1]?.index ?? config.length);
      // A comment mentioning the old wrapper is not proof of ownership.
      const launchSettings = block.replace(/#[^\r\n]*/g, '').match(/^[ \t]*(?:command[ \t]*=[^\r\n]*|args[ \t]*=[ \t]*\[[^\]]*\])/gm) || [];
      return launchSettings.some(setting => setting.includes('serena-mcp.mjs'));
    });
    if (managed) {
      let updated = config;
      for (let index = sections.length - 1; index >= 0; index--) {
        if (!identity.test(sections[index][1].trim())) continue;
        const end = sections[index + 1]?.index ?? config.length;
        updated = updated.slice(0, sections[index].index) + updated.slice(end);
      }
      await replace(configPath, Buffer.from(updated));
    }
  }
  const rulesPath = path.join(root, 'skill-registry/routing-rules.json');
  const rulesBytes = await optional(rulesPath);
  if (rulesBytes) {
    const rules = JSON.parse(rulesBytes);
    if (Object.hasOwn(rules, 'navigate-code-with-serena')) {
      delete rules['navigate-code-with-serena'];
      await replace(rulesPath, Buffer.from(JSON.stringify(rules, null, 2) + '\n'));
    }
  }
  for (const relative of ['.agents/skills/navigate-code-with-serena',
    '.codex/tools/ai-engineering-governance-template/codex-profile/global-skills/navigate-code-with-serena']) {
    await remove(relative, 'SKILL.md', text => /^name: navigate-code-with-serena\s*$/m.test(text), 'Skill');
  }
  const wrapperIdentity = text => text.includes('tools/serena-runtime.json') && text.includes('--project-from-cwd');
  await remove('.codex/tools/serena-mcp.mjs', '', wrapperIdentity);
  await remove('.codex/tools/serena-runtime.json', '', text => {
    try {
      const runtime = JSON.parse(text);
      return typeof runtime.version === 'string' && typeof runtime.python === 'string' && /[/\\]serena(?:\.exe)?$/.test(runtime.executable);
    } catch { return false; }
  });
  await remove('.codex/tools/serena-navigation', 'navigation.yml', text => text.includes('Global read-only source navigation for Codex'));
  const mirror = '.codex/tools/ai-engineering-governance-template/';
  await remove(mirror + 'scripts/serena-mcp.mjs', '', wrapperIdentity);
  await remove(mirror + 'scripts/install-serena-mcp.mjs', '', text => text.includes('serena-runtime.json') && text.includes('serena-navigation'));
  await remove(mirror + 'codex-profile/serena', 'navigation.yml', text => text.includes('Global read-only source navigation for Codex'));
  if (check && operations.length) throw new Error('Managed Serena remnants still installed: ' + operations.map(op => path.relative(home, op.file)).join(', '));
  // Validate every target first; never back up the rejected implementation.
  for (const operation of operations) {
    if (operation.remove) {
      await rm(operation.file, { recursive: true });
    } else {
      const temporary = operation.file + '.' + process.pid + '.tmp';
      let created = false;
      try {
        await writeFile(temporary, operation.bytes, { mode: operation.mode, flag: 'wx' });
        created = true;
        await rename(temporary, operation.file);
      } finally { if (created) await rm(temporary, { force: true }); }
    }
  }
  const changes = operations.map(op => path.relative(home, op.file));
  return { status: changes.length ? 'retired' : 'current', changes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = { check: args.includes('--check') };
  if (args.includes('--home')) {
    options.home = args[args.indexOf('--home') + 1];
    if (!options.home) throw new Error('--home requires a path');
  }
  console.log(JSON.stringify(await retireSerena(options)));
}
