#!/usr/bin/env node
// Publish the tested bytes; never rebuild a different variant during rollout.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphInputsHash } from '../codex-profile/mac/hooks/registry-inputs.mjs';
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2), check = args.includes('--check');
const stage = path.resolve(args.includes('--candidate') ? args[args.indexOf('--candidate') + 1] : path.join(repo, '.reports/retrieval-candidate'));
const home = os.homedir(), root = path.join(home, '.codex'), registry = path.join(root, 'skill-registry');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const graphBytes = await readFile(path.join(stage, 'skill-registry/skills.graph.json'));
const graphSha256 = digest(graphBytes);
const workerSha256 = digest(await readFile(path.join(repo, 'codex-profile/mac/hooks/graph_skill_index.py')));
for (const file of ['routed-retrieval-final.json', 'multilingual-projected-load100.json', 'multilingual-projected-stagger100.json']) {
  const report = JSON.parse(await readFile(path.join(repo, '.reports', file), 'utf8'));
  if (report.graphSha256 !== graphSha256 || report.workerSha256 !== workerSha256) throw new Error('Candidate differs from tested artifact: ' + file);
  if ('success' in report && (report.count !== 100 || report.success !== 100)) throw new Error('Load evidence failed: ' + file);
  if ('mcpHits' in report && report.mcpHits !== report.mcpTotal) throw new Error('MCP identity probes failed');
}
const manifest = JSON.parse(await readFile(path.join(stage, 'skill-registry/skills.graph.manifest.json'), 'utf8'));
if (manifest.ownedSkillCount !== 22 || !manifest.chineseEmbedding) throw new Error('Missing owned Skills or Chinese embeddings');
const graph = JSON.parse(graphBytes), sidecar = graph.metadata.chinese_embedding;
if (!sidecar || path.basename(sidecar.file) !== sidecar.file) throw new Error('Invalid vector sidecar');
const vectorBytes = await readFile(path.join(stage, 'skill-registry', sidecar.file));
if (digest(vectorBytes) !== sidecar.sha256) throw new Error('Vector checksum mismatch');
const descriptionVectors = new Map();
for (const config of Object.values(graph.metadata.description_embeddings || {})) {
  if (path.basename(config.file) !== config.file) throw new Error('Invalid description vector path');
  const bytes = await readFile(path.join(stage, 'skill-registry', config.file));
  if (digest(bytes) !== config.sha256) throw new Error('Description vector checksum mismatch');
  descriptionVectors.set(config.file, bytes);
}
const mcp = JSON.parse(await readFile(path.join(stage, 'mcp-tools.json'), 'utf8'));
const configPath = path.join(registry, 'external-library-config.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const catalog = config.catalog || path.join(config.root, '_catalog_cn.json');
if (digest(await readFile(catalog)) !== manifest.catalogSha256) throw new Error('Catalog changed since candidate build');
const catalogStat = await stat(catalog), globalGraph = path.join(registry, 'skills.graph.json');
const externalManifest = { ...manifest, catalogPath: catalog, catalogLength: catalogStat.size,
  catalogMtimeMs: catalogStat.mtimeMs, graphInputsSha256: await graphInputsHash(path.join(home, '.agents/skills'), mcp.tools),
  graphPath: globalGraph, graphManifestPath: path.join(registry, 'skills.graph.manifest.json'),
  indexerPath: path.join(root, 'hooks/graph_skill_index.py'), pythonPath: path.join(root, 'tools/graph-tool-call-venv/bin/python') };
const index = JSON.parse(await readFile(path.join(registry, 'skills-index.json'), 'utf8'));
index.skills = index.skills.filter(s => s.name !== 'navigate-code-with-serena');
Object.assign(index, {generatedAt:new Date().toISOString(), ownedSkillCount:manifest.ownedSkillCount,
  externalSkillCount:manifest.externalSkillCount, externalMissingSkillCount:manifest.missingSkillCount,
  skillCount:index.skills.length, externalGraphPath:globalGraph});
const rulesPath = path.join(registry, 'routing-rules.json'), rules = JSON.parse(await readFile(rulesPath, 'utf8'));
delete rules['navigate-code-with-serena'];
const json = value => Buffer.from(JSON.stringify(value,null,2) + '\n');
const writes = new Map();
writes.set(path.join(root,'hooks/skill-router.mjs'), await readFile(path.join(repo,'codex-profile/.codex/hooks/skill-router.mjs')));
for (const name of ['graph_skill_index.py','skill-retrieval.zh.json','mcp-retrieval.zh.json','mcp-catalog.mjs','registry-inputs.mjs','refresh-skill-registry.mjs']) {
  writes.set(path.join(root,'hooks',name), await readFile(path.join(repo,'codex-profile/mac/hooks',name)));
}
writes.set(path.join(registry,sidecar.file),vectorBytes);
for (const [file,bytes] of descriptionVectors) writes.set(path.join(registry,file),bytes);
writes.set(globalGraph,graphBytes);
writes.set(path.join(registry,'skills.graph.manifest.json'),json({...manifest,graphPath:globalGraph}));
writes.set(path.join(registry,'external-skills-manifest.json'),json(externalManifest));
writes.set(path.join(registry,'mcp-tools.json'),json(mcp));
writes.set(path.join(registry,'skills-index.json'),json(index));
writes.set(configPath,json({...config,chineseEmbedding:manifest.chineseEmbedding}));
writes.set(rulesPath,json(rules));
if (check) {
  console.log(JSON.stringify({status:'candidate-verified',graphSha256,workerSha256,mcpTools:mcp.tools.length,writes:writes.size}));
} else {
  const backup = path.join(root,'backups/retrieval',new Date().toISOString().replaceAll(':','-'));
  await mkdir(backup,{recursive:true,mode:0o700});
  const originals = new Map();
  for (const file of writes.keys()) {
    try { originals.set(file,await readFile(file)); await copyFile(file,path.join(backup,path.basename(file))); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async function atomic(file,bytes) {
    const temporary = file + `.${process.pid}.tmp`;
    await writeFile(temporary,bytes,{mode:0o600}); await rename(temporary,file);
  }
  try {
    for (const [file,bytes] of writes) {
      if (!originals.get(file)?.equals(bytes)) await atomic(file,bytes);
    }
    if (digest(await readFile(globalGraph)) !== graphSha256) throw new Error('Published checksum mismatch');
    const receipt = {status:'published',backup,graphSha256,workerSha256,ownedSkills:manifest.ownedSkillCount,
      externalSkills:manifest.externalSkillCount,mcpTools:mcp.tools.length};
    await writeFile(path.join(repo,'.reports/retrieval-publication.json'),json(receipt));
    console.log(JSON.stringify(receipt));
  } catch (error) {
    for (const [file,bytes] of originals) await atomic(file,bytes);
    throw error;
  }
}
