import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function skillFiles(root) {
  const result = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await Promise.all(entries.map(async entry => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name === 'SKILL.md') result.push(target);
    }));
  }
  await visit(root);
  return result.sort();
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
  return value;
}

export async function graphInputsHash(ownedRoot, mcpTools, resourceCatalog) {
  const hash = createHash('sha256');
  for (const name of ['graph_skill_index.py', 'skill-retrieval.zh.json', 'mcp-retrieval.zh.json']) {
    hash.update(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), name)));
  }
  for (const file of await skillFiles(ownedRoot)) {
    hash.update(path.relative(ownedRoot, file)); hash.update('\0');
    hash.update(await readFile(file)); hash.update('\0');
  }
  hash.update(JSON.stringify(mcpTools.map(tool => JSON.stringify(stableJson(tool))).sort()));
  // Importers publish content hashes in this small manifest. Do not walk every
  // complete third-party package from a Hook or query worker.
  if (resourceCatalog) {
    try { const content = await readFile(resourceCatalog); hash.update('\0resource-modules\0'); hash.update(content); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return hash.digest('hex');
}
