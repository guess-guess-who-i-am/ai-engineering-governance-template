#!/usr/bin/env node
// Verify every candidate/source byte before an ordered, rollback-capable publish.
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const kinds = ['expert', 'skill', 'mcp-service'];
async function optional(file) { try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function atomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + `.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try { await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, file); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function sameSet(actual, expected, label) {
  if (actual.size !== expected.size || [...actual].some(value => !expected.has(value))) throw new Error(label + ' mismatch');
}
function checkedNumber(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid ' + label);
  return value;
}

export async function publishResourceGraph({ codexRoot = path.join(os.homedir(), '.codex'), stage, ownedRoot = path.join(os.homedir(), '.agents/skills'), report, check = false, writer = atomic } = {}) {
  codexRoot = path.resolve(codexRoot); ownedRoot = path.resolve(ownedRoot);
  const registry = path.join(codexRoot, 'skill-registry');
  stage = await realpath(stage || path.join(registry, 'resource-candidate'));
  if (stage === registry || stage === codexRoot || stage.startsWith(path.join(codexRoot, 'hooks') + path.sep)) throw new Error('Stage must be separate from production paths');
  const buildBytes = await readFile(path.join(stage, 'build-report.json'));
  const build = JSON.parse(buildBytes);
  if (build.schemaVersion !== 'resource-graph-candidate/1' || !build.inputsSha256 || !build.publishFiles || !Object.keys(build.inputsSha256).length) throw new Error('Invalid build report');
  const baseBuildReportSha256 = digest(buildBytes);
  const runtimeBytes = await optional(path.join(stage, 'runtime-revalidation.json'));
  let effective = build, runtimeRevalidationSha256 = null;
  if (runtimeBytes) {
    const runtime = JSON.parse(runtimeBytes);
    if (runtime.schemaVersion !== 'resource-runtime-revalidation/1' || runtime.baseBuildReportSha256 !== baseBuildReportSha256 ||
        runtime.graphAndVectorsUnchanged !== true || runtime.runtimeOnlyAstVerified !== true || !runtime.inputsSha256 || !runtime.publishFiles) throw new Error('Invalid runtime revalidation or mismatched base build');
    for (const field of ['inputsSha256', 'publishFiles']) sameSet(new Set(Object.keys(runtime[field])), new Set(Object.keys(build[field])), 'Runtime ' + field + ' key set');
    const allowedInputs = new Set(), allowedPublish = new Set();
    for (const name of ['graph_skill_index.py', 'skill-router.mjs']) {
      const inputKeys = Object.keys(build.inputsSha256).filter(file => path.basename(file) === name);
      const publishKeys = [];
      for (const file of Object.keys(build.publishFiles)) if (await realpath(file) === path.join(stage, 'hooks', name)) publishKeys.push(file);
      if (inputKeys.length !== 1 || publishKeys.length !== 1) throw new Error('Ambiguous runtime hook identity: ' + name);
      const input = inputKeys[0], output = publishKeys[0], expected = name === 'graph_skill_index.py' ? runtime.workerSha256 : runtime.routerSha256;
      if (!/^[a-f0-9]{64}$/.test(expected || '') || runtime.inputsSha256[input] !== expected || runtime.publishFiles[output] !== expected) throw new Error('Runtime source/staged hash mismatch: ' + name);
      allowedInputs.add(input); allowedPublish.add(output);
    }
    for (const [field, allowed] of [['inputsSha256', allowedInputs], ['publishFiles', allowedPublish]]) {
      for (const [file, expected] of Object.entries(build[field])) if (!allowed.has(file) && runtime[field][file] !== expected) throw new Error('Runtime revalidation changed non-runtime artifact: ' + file);
    }
    effective = runtime; runtimeRevalidationSha256 = digest(runtimeBytes);
  }
  const sourceBytes = new Map();
  const sourceEntries = Object.entries(effective.inputsSha256);
  let sourceCursor = 0;
  await Promise.all(Array.from({length: Math.min(8, sourceEntries.length)}, async () => {
    while (sourceCursor < sourceEntries.length) {
      const [file, expected] = sourceEntries[sourceCursor++];
      const target = path.resolve(file), bytes = await readFile(target);
      if (digest(bytes) !== expected) throw new Error('Source input changed since build: ' + target);
      sourceBytes.set(target, bytes);
    }
  }));
  const staged = new Map();
  await Promise.all(Object.entries(effective.publishFiles).map(async ([file, expected]) => {
    const target = path.resolve(file), resolved = await realpath(target);
    if (!resolved.startsWith(stage + path.sep)) throw new Error('Publish file escapes stage: ' + target);
    const bytes = await readFile(target);
    if (digest(bytes) !== expected) throw new Error('Candidate checksum mismatch: ' + target);
    staged.set(path.relative(stage, resolved), bytes);
  }));
  const required = relative => {
    const bytes = staged.get(relative);
    if (!bytes) throw new Error('Unverified candidate file: ' + relative);
    return bytes;
  };
  const graphBytes = required('skills.graph.json'), graph = JSON.parse(graphBytes);
  const manifest = JSON.parse(required('skills.graph.manifest.json'));
  if (!graph.tools || Array.isArray(graph.tools) || !graph.metadata || manifest.schemaVersion !== 'graph-tool-call-skills/1') throw new Error('Invalid graph or manifest');
  const config = JSON.parse(await readFile(path.join(registry, 'external-library-config.json'), 'utf8'));
  const catalog = path.resolve(config.catalog || path.join(config.root, '_catalog_cn.json'));
  const resourceCatalog = path.resolve(manifest.resourceCatalogPath || path.join(registry, 'resource-modules.json'));
  const mcpCatalog = path.join(registry, 'mcp-tools.json');
  for (const file of [catalog, resourceCatalog, mcpCatalog]) if (!sourceBytes.has(file)) throw new Error('Required source absent from build inputs: ' + file);
  if (path.resolve(manifest.catalogPath) !== catalog || digest(sourceBytes.get(catalog)) !== manifest.catalogSha256) throw new Error('Catalog identity mismatch');
  const resources = JSON.parse(sourceBytes.get(resourceCatalog)), mcp = JSON.parse(sourceBytes.get(mcpCatalog));
  if (!Array.isArray(resources.modules) || !Array.isArray(mcp.tools)) throw new Error('Invalid resource or MCP catalog');
  const ids = resources.modules.map(module => module.id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('Duplicate or invalid resource identity');
  const actualIds = Object.values(graph.tools).map(node => node.metadata?.module_id).filter(Boolean);
  sameSet(new Set(actualIds), new Set(ids), 'Resource coverage');
  if (actualIds.length !== ids.length) throw new Error('Resource module was split or duplicated in graph');
  const counts = Object.fromEntries(kinds.map(kind => [kind, resources.modules.filter(module => module.kind === kind).length]));
  if (Object.values(counts).reduce((a, b) => a + b, 0) !== ids.length) throw new Error('Unknown resource module kind');
  for (const kind of kinds) if (manifest.resourceModuleCounts?.[kind] !== counts[kind]) throw new Error('Resource kind count mismatch: ' + kind);
  for (const [value, label] of [[manifest.resourceModuleCount, 'manifest resources'], [build.resourceModuleCount, 'build resources'], [graph.metadata.resource_module_count, 'graph resources']]) if (value !== ids.length) throw new Error('Resource count mismatch: ' + label);
  if (build.graphNodeCount !== Object.keys(graph.tools).length) throw new Error('Graph node count mismatch');
  const sidecars = new Map();
  const checkSidecar = config => {
    if (!config || typeof config.file !== 'string' || path.basename(config.file) !== config.file || !config.sha256) throw new Error('Invalid embedding sidecar reference');
    const bytes = required(config.file);
    if (digest(bytes) !== config.sha256) throw new Error('Embedding sidecar checksum mismatch: ' + config.file);
    sidecars.set(config.file, bytes);
  };
  if (graph.metadata.chinese_embedding) checkSidecar(graph.metadata.chinese_embedding);
  if (manifest.chineseEmbedding && !graph.metadata.chinese_embedding) throw new Error('Missing Chinese embedding sidecar');
  for (const config of Object.values(graph.metadata.description_embeddings || {})) checkSidecar(config);
  if (manifest.embedding && manifest.embedding !== 'disabled' && !graph.metadata.description_embeddings?.en) throw new Error('Missing English description sidecar');
  if (manifest.chineseEmbedding && !graph.metadata.description_embeddings?.zh) throw new Error('Missing Chinese description sidecar');
  // Candidate verification may create __pycache__. Only explicitly hashed hook
  // entries are publishable; unreported cache/output directories are irrelevant.
  const hookNames = [...staged.keys()].filter(relative => relative.startsWith('hooks' + path.sep)).map(relative => {
    const name = path.basename(relative);
    if (path.dirname(relative) !== 'hooks' || !/^[a-zA-Z0-9._-]+\.(?:mjs|py|json)$/.test(name)) throw new Error('Unexpected staged hook');
    return name;
  });
  for (const name of ['registry-inputs.mjs', 'graph_skill_index.py', 'artifact_relations.py', 'semantic_relations.py', 'complete_embedding.py', 'skill-retrieval.zh.json', 'mcp-retrieval.zh.json']) if (!hookNames.includes(name)) throw new Error('Missing staged hook: ' + name);
  const semantic = graph.metadata.semantic_relations;
  if (semantic?.registrySha256) {
    const bytes = required(path.join('hooks', 'semantic-relations.json'));
    const relations = JSON.parse(bytes);
    if (digest(bytes) !== semantic.registrySha256 || relations.verification?.complete !== true) throw new Error('Semantic relation registry checksum or verification mismatch');
    checkedNumber(semantic.processed, 'semantic processed'); checkedNumber(semantic.unmatched, 'semantic unmatched');
    if (semantic.processed + semantic.unmatched !== Object.keys(graph.tools).length || semantic.state !== (semantic.unmatched ? 'needs-rebuild' : 'ready')) throw new Error('Semantic relation coverage inconsistent');
  }
  const allowed = new Set(['skills.graph.json', 'skills.graph.manifest.json', ...sidecars.keys(), ...hookNames.map(name => path.join('hooks', name))]);
  sameSet(new Set(staged.keys()), allowed, 'Publication file allowlist');
  const hashModule = await import(pathToFileURL(path.join(stage, 'hooks/registry-inputs.mjs')).href + '?sha=' + digest(required('hooks/registry-inputs.mjs')));
  const ownedFiles = await hashModule.skillFiles(ownedRoot);
  for (const file of ownedFiles) if (!sourceBytes.has(path.resolve(file))) throw new Error('Owned Skill not included in candidate: ' + file);
  if (manifest.ownedSkillCount !== ownedFiles.length) throw new Error('Owned Skill coverage changed');
  checkedNumber(manifest.externalSkillCount, 'external Skill count');
  if (manifest.mcpToolCount !== mcp.tools.length) throw new Error('MCP tool coverage changed');
  const inputsHash = await hashModule.graphInputsHash(ownedRoot, mcp.tools, resourceCatalog);
  // Recheck after graphInputsHash reads its sources; all checks precede any write.
  for (const [file, bytes] of sourceBytes) if (digest(await readFile(file)) !== digest(bytes)) throw new Error('Source input changed during validation: ' + file);
  if (digest(await readFile(path.join(stage, 'build-report.json'))) !== baseBuildReportSha256) throw new Error('Build report changed during validation');
  const currentRuntime = await optional(path.join(stage, 'runtime-revalidation.json'));
  if ((currentRuntime ? digest(currentRuntime) : null) !== runtimeRevalidationSha256) throw new Error('Runtime revalidation changed during validation');
  const graphPath = path.join(registry, 'skills.graph.json'), manifestPath = path.join(registry, 'skills.graph.manifest.json');
  const catalogStat = await stat(catalog);
  const publishedResourceCatalog = path.join(registry, 'resource-modules.json');
  const updatedManifest = { ...manifest, graphPath, resourceCatalogPath: publishedResourceCatalog, graphInputsSha256: inputsHash };
  const externalManifest = { ...updatedManifest, catalogPath: catalog, catalogLength: catalogStat.size, catalogMtimeMs: catalogStat.mtimeMs,
    graphManifestPath: manifestPath, indexerPath: path.join(codexRoot, 'hooks/graph_skill_index.py'), pythonPath: path.join(codexRoot, 'tools/graph-tool-call-venv/bin/python') };
  const indexPath = path.join(registry, 'skills-index.json'), index = JSON.parse(await readFile(indexPath, 'utf8'));
  if (!Array.isArray(index.skills)) throw new Error('Existing registry skills must be an array');
  Object.assign(index, { generatedAt: new Date().toISOString(), resourceModuleCount: ids.length, resourceModuleCounts: counts,
    resourceCatalogPath: publishedResourceCatalog, ownedSkillCount: manifest.ownedSkillCount, externalSkillCount: manifest.externalSkillCount,
    externalMissingSkillCount: checkedNumber(manifest.missingSkillCount, 'missing Skill count'), externalGraphPath: graphPath });
  const writes = new Map();
  writes.set(publishedResourceCatalog, sourceBytes.get(resourceCatalog));
  for (const name of hookNames) writes.set(path.join(codexRoot, 'hooks', name), required(path.join('hooks', name)));
  for (const [name, bytes] of sidecars) writes.set(path.join(registry, name), bytes);
  writes.set(manifestPath, json(updatedManifest));
  writes.set(path.join(registry, 'external-skills-manifest.json'), json(externalManifest));
  writes.set(indexPath, json(index));
  writes.set(graphPath, graphBytes); // Worker-visible commit point: graph always last.
  const receipt = { status: check ? 'candidate-verified' : 'published', graphSha256: digest(graphBytes), graphInputsSha256: inputsHash,
    baseBuildReportSha256, runtimeRevalidationSha256, workerSha256: digest(required('hooks/graph_skill_index.py')),
    routerSha256: staged.has('hooks/skill-router.mjs') ? digest(required('hooks/skill-router.mjs')) : null,
    runtimeOnlyAstVerified: !!runtimeBytes, verificationScope: 'Current artifact integrity and coverage; task evaluation evidence is separate',
    resourceModuleCount: ids.length, resourceModuleCounts: counts, ownedSkillCount: manifest.ownedSkillCount,
    externalSkillCount: manifest.externalSkillCount, mcpToolCount: mcp.tools.length, writes: writes.size, productionChanged: !check };
  if (check) return receipt;
  const originals = new Map(await Promise.all([...writes.keys()].map(async file => [file, await optional(file)])));
  const touched = [];
  try {
    for (const [file, bytes] of writes) {
      if (originals.get(file)?.equals(bytes)) continue;
      touched.push(file); await writer(file, bytes);
    }
    if (digest(await readFile(graphPath)) !== receipt.graphSha256) throw new Error('Published graph checksum mismatch');
    if (report) await atomic(path.resolve(report), json(receipt));
  } catch (error) {
    const rollbackErrors = [];
    for (const file of touched.reverse()) {
      try { const bytes = originals.get(file); if (bytes) await atomic(file, bytes); else await unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
      catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors.map(message => new Error(message))], 'Publish failed and rollback was incomplete');
    throw error;
  }
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), get = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  try { console.log(JSON.stringify(await publishResourceGraph({ codexRoot: get('--codex-root'), stage: get('--stage'), ownedRoot: get('--owned-root'), report: get('--report'), check: args.includes('--check') }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
