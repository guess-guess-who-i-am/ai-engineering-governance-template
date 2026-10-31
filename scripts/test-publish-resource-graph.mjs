#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { publishResourceGraph } from './publish-resource-graph.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
async function put(root, relative, value) {
  const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value); return file;
}
async function snapshot(root) {
  const files = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file); else files[path.relative(root, file)] = (await readFile(file)).toString('base64');
    }
  }
  await visit(root); return files;
}
async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'resource-publish-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const codexRoot = path.join(temp, 'global'), registry = path.join(codexRoot, 'skill-registry');
  const stage = path.join(registry, 'resource-candidate'), ownedRoot = path.join(temp, 'owned');
  const inputFiles = [], publishFiles = [];
  const catalog = await put(temp, 'external/catalog.json', '{"skills":[]}\n'); inputFiles.push(catalog);
  await put(registry, 'external-library-config.json', json({ root: path.dirname(catalog), catalog, unchangedConfig: true }));
  const resources = ['expert', 'skill', 'mcp-service'].map((kind, index) => ({ id: 'fixture-' + kind, name: kind, kind, description: 'module ' + index }));
  const resourceCatalog = await put(registry, 'resource-modules.json', json({ modules: resources })); inputFiles.push(resourceCatalog);
  const mcp = { tools: [{ tool_name: 'native-tool', name: 'search', server: 'fixture', description: 'native search' }] };
  inputFiles.push(await put(registry, 'mcp-tools.json', json(mcp)));
  for (let i = 0; i < 3; i++) inputFiles.push(await put(ownedRoot, `owned-${i}/SKILL.md`, `---\nname: owned-${i}\ndescription: Test ${i}\n---\n`));
  const hookNames = ['registry-inputs.mjs', 'graph_skill_index.py', 'skill-retrieval.zh.json', 'mcp-retrieval.zh.json', 'skill-router.mjs'];
  for (const name of hookNames) {
    const bytes = name === 'registry-inputs.mjs' ? await readFile(path.join(repo, 'codex-profile/mac/hooks', name)) : Buffer.from(name.endsWith('.json') ? '{}\n' : '# fixture-hook-' + name + '\n');
    inputFiles.push(await put(temp, 'source-hooks/' + name, bytes));
    publishFiles.push(await put(stage, 'hooks/' + name, bytes));
  }
  const sidecar = async name => {
    const file = await put(stage, name, Buffer.from('verified-vector-data-' + name)); publishFiles.push(file);
    return { file: name, sha256: sha(await readFile(file)) };
  };
  const graph = { metadata: { resource_module_count: 3, chinese_embedding: await sidecar('chinese-vectors.bin'),
    description_embeddings: { en: await sidecar('description-en.bin'), zh: await sidecar('description-zh.bin') } },
    tools: Object.fromEntries(resources.map(module => [module.id, { metadata: { module_id: module.id, kind: module.kind } }])) };
  for (let i = 0; i < 6; i++) graph.tools['ordinary-' + i] = { metadata: {} };
  const graphPath = await put(stage, 'skills.graph.json', json(graph)); publishFiles.push(graphPath);
  const manifest = { schemaVersion: 'graph-tool-call-skills/1', ownedSkillCount: 3, externalSkillCount: 2,
    skillCount: 5, mcpToolCount: 1, resourceModuleCount: 3, resourceModuleCounts: { expert: 1, skill: 1, 'mcp-service': 1 },
    missingSkillCount: 0, invalidSkillCount: 0, resourceCatalogPath: resourceCatalog, catalogPath: catalog,
    catalogSha256: sha(await readFile(catalog)), graphPath, rootPath: path.dirname(catalog),
    embedding: 'sentence-transformers/all-MiniLM-L6-v2', chineseEmbedding: 'fixture-multilingual' };
  publishFiles.push(await put(stage, 'skills.graph.manifest.json', json(manifest)));
  const build = { schemaVersion: 'resource-graph-candidate/1', resourceModuleCount: 3, graphNodeCount: 9,
    inputsSha256: Object.fromEntries(await Promise.all(inputFiles.map(async file => [file, sha(await readFile(file))]))),
    publishFiles: Object.fromEntries(await Promise.all(publishFiles.map(async file => [file, sha(await readFile(file))]))) };
  await put(stage, 'build-report.json', json(build));
  const originalSkills = [{ name: 'keep-original', path: '/fixture/keep', arbitrary: { keep: true } }];
  await put(registry, 'skills-index.json', json({ skills: originalSkills, skillCount: 1, retainField: 'unchanged' }));
  await put(registry, 'skills.graph.json', '{"oldGraph":true}\n');
  await put(registry, 'skills.graph.manifest.json', '{"oldManifest":true}\n');
  await put(registry, 'external-skills-manifest.json', '{"oldExternal":true}\n');
  await put(codexRoot, 'hooks/skill-router.mjs', '// original hook\n');
  await put(codexRoot, 'config.toml', '[auth]\nfixture="never-touch"\n');
  return { temp, codexRoot, registry, stage, ownedRoot, catalog, resourceCatalog, graph, manifest, build, originalSkills };
}
async function rehashCandidate(f, relative, value) {
  const file = await put(f.stage, relative, json(value));
  f.build.publishFiles[file] = sha(await readFile(file));
  await put(f.stage, 'build-report.json', json(f.build));
}
async function runtimeUpdate(f) {
  const baseBytes = await readFile(path.join(f.stage, 'build-report.json'));
  const runtime = { schemaVersion: 'resource-runtime-revalidation/1', baseBuildReportSha256: sha(baseBytes),
    graphAndVectorsUnchanged: true, runtimeOnlyAstVerified: true, inputsSha256: { ...f.build.inputsSha256 }, publishFiles: { ...f.build.publishFiles } };
  for (const name of ['graph_skill_index.py', 'skill-router.mjs']) {
    const bytes = Buffer.from('# verified runtime update ' + name + '\n');
    const input = Object.keys(runtime.inputsSha256).find(file => path.basename(file) === name);
    const output = path.join(f.stage, 'hooks', name);
    await writeFile(input, bytes); await writeFile(output, bytes);
    runtime.inputsSha256[input] = sha(bytes); runtime.publishFiles[output] = sha(bytes);
    runtime[name === 'graph_skill_index.py' ? 'workerSha256' : 'routerSha256'] = sha(bytes);
  }
  await put(f.stage, 'runtime-revalidation.json', json(runtime));
  return { runtime, baseBytes };
}

test('check validates candidate without changing global bytes or writing report', async t => {
  const f = await fixture(t), before = await snapshot(f.codexRoot), report = path.join(f.temp, 'check-report.json');
  const receipt = await publishResourceGraph({ ...f, check: true, report });
  assert.equal(receipt.status, 'candidate-verified'); assert.equal(receipt.productionChanged, false);
  assert.deepEqual(await snapshot(f.codexRoot), before);
  await assert.rejects(access(report));
});

test('staged resource descriptions publish with the graph and retain the canonical global catalog path', async t => {
  const f = await fixture(t);
  const resources = JSON.parse(await readFile(f.resourceCatalog,'utf8'));
  resources.modules[0].description='Original primary role scope, not marketing';
  const candidate=await put(f.stage,'resource-modules.json',json(resources));
  f.build.inputsSha256[candidate]=sha(await readFile(candidate));
  await rehashCandidate(f,'skills.graph.manifest.json',{...f.manifest,resourceCatalogPath:candidate});
  await publishResourceGraph(f);
  assert.deepEqual(JSON.parse(await readFile(f.resourceCatalog,'utf8')),resources);
  for(const file of ['skills.graph.manifest.json','external-skills-manifest.json','skills-index.json'])
    assert.equal(JSON.parse(await readFile(path.join(f.registry,file),'utf8')).resourceCatalogPath,f.resourceCatalog);
});

test('CLI check accepts explicit roots and exits without global mutation', async t => {
  const f = await fixture(t), before = await snapshot(f.codexRoot);
  const output = execFileSync(process.execPath, [path.join(repo, 'scripts/publish-resource-graph.mjs'), '--codex-root', f.codexRoot, '--stage', f.stage, '--owned-root', f.ownedRoot, '--check'], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).status, 'candidate-verified');
  assert.deepEqual(await snapshot(f.codexRoot), before);
});

test('real Python candidate import cache does not become a publication input', async t => {
  const f = await fixture(t), script = path.join(f.stage, 'hooks/graph_skill_index.py');
  execFileSync('python3', ['-c', 'import importlib.util, sys; s=importlib.util.spec_from_file_location("candidate_fixture",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)', script]);
  assert((await readdir(path.join(f.stage, 'hooks/__pycache__'))).some(name => name.endsWith('.pyc')));
  const before = await snapshot(f.codexRoot);
  const receipt = await publishResourceGraph({ ...f, check: true });
  assert.equal(receipt.status, 'candidate-verified');
  assert.deepEqual(await snapshot(f.codexRoot), before);
  await publishResourceGraph(f);
  await assert.rejects(access(path.join(f.codexRoot, 'hooks/__pycache__')));
});

test('runtime revalidation accepts only the declared worker/router update without rewriting the frozen build record', async t => {
  const f = await fixture(t), { runtime, baseBytes } = await runtimeUpdate(f), before = await snapshot(f.codexRoot);
  const receipt = await publishResourceGraph({ ...f, check: true });
  assert.equal(receipt.baseBuildReportSha256, sha(baseBytes));
  assert.equal(receipt.runtimeRevalidationSha256, sha(await readFile(path.join(f.stage, 'runtime-revalidation.json'))));
  assert.equal(receipt.workerSha256, runtime.workerSha256); assert.equal(receipt.routerSha256, runtime.routerSha256);
  assert.equal(receipt.runtimeOnlyAstVerified, true);
  assert.deepEqual(await readFile(path.join(f.stage, 'build-report.json')), baseBytes);
  assert.deepEqual(await snapshot(f.codexRoot), before);
});

test('runtime records cannot change graph hashes, source key sets, base identity, or verification flags', async t => {
  for (const type of ['graph', 'sidecar', 'base', 'key-set', 'ast-flag', 'worker-hash']) {
    const f = await fixture(t), { runtime } = await runtimeUpdate(f);
    if (type === 'graph') {
      const file = path.join(f.stage, 'skills.graph.json'); await writeFile(file, json({ ...f.graph, altered: true }));
      runtime.publishFiles[file] = sha(await readFile(file));
    }
    if (type === 'sidecar') {
      const file = path.join(f.stage, 'description-en.bin'); await writeFile(file, 'changed vectors');
      runtime.publishFiles[file] = sha(await readFile(file));
    }
    if (type === 'base') runtime.baseBuildReportSha256 = '0'.repeat(64);
    if (type === 'key-set') runtime.inputsSha256['/new-untracked-input'] = '0'.repeat(64);
    if (type === 'ast-flag') runtime.runtimeOnlyAstVerified = false;
    if (type === 'worker-hash') runtime.workerSha256 = '0'.repeat(64);
    await put(f.stage, 'runtime-revalidation.json', json(runtime));
    const before = await snapshot(f.codexRoot); let writes = 0;
    await assert.rejects(publishResourceGraph({ ...f, writer: async () => { writes++; } }), /Runtime|runtime|base build/);
    assert.equal(writes, 0); assert.deepEqual(await snapshot(f.codexRoot), before);
  }
});

test('publication preserves original registry/auth and writes verified sidecars before graph commit', async t => {
  const f = await fixture(t), writes = [], beforeConfig = await readFile(path.join(f.codexRoot, 'config.toml'));
  const report = path.join(f.temp, 'published.json');
  const result = await publishResourceGraph({ ...f, report, writer: async (file, bytes) => { writes.push(file); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); } });
  assert.equal(result.ownedSkillCount, 3, 'must not hardcode legacy owned count');
  assert.equal(writes.at(-1), path.join(f.registry, 'skills.graph.json'));
  for (const name of ['chinese-vectors.bin', 'description-en.bin', 'description-zh.bin']) {
    assert(writes.indexOf(path.join(f.registry, name)) < writes.indexOf(path.join(f.registry, 'skills.graph.json')));
    assert.deepEqual(await readFile(path.join(f.registry, name)), await readFile(path.join(f.stage, name)));
  }
  assert.deepEqual(await readFile(path.join(f.registry, 'skills.graph.json')), await readFile(path.join(f.stage, 'skills.graph.json')));
  const index = JSON.parse(await readFile(path.join(f.registry, 'skills-index.json')));
  assert.deepEqual(index.skills, f.originalSkills); assert.equal(index.skillCount, 1); assert.equal(index.retainField, 'unchanged');
  assert.equal(index.resourceModuleCount, 3); assert.deepEqual(index.resourceModuleCounts, { expert: 1, skill: 1, 'mcp-service': 1 });
  assert.equal(index.resourceCatalogPath, f.resourceCatalog); assert.equal(index.externalGraphPath, path.join(f.registry, 'skills.graph.json'));
  const hashModule = await import(pathToFileURL(path.join(f.stage, 'hooks/registry-inputs.mjs')).href);
  const expectedHash = await hashModule.graphInputsHash(f.ownedRoot, JSON.parse(await readFile(path.join(f.registry, 'mcp-tools.json'))).tools, f.resourceCatalog);
  for (const name of ['skills.graph.manifest.json', 'external-skills-manifest.json']) assert.equal(JSON.parse(await readFile(path.join(f.registry, name))).graphInputsSha256, expectedHash);
  assert.deepEqual(await readFile(path.join(f.codexRoot, 'config.toml')), beforeConfig);
  assert.equal(JSON.parse(await readFile(report)).status, 'published');
  await assert.rejects(access(path.join(f.codexRoot, 'backups')));
});

test('changed source input and changed candidate bytes are rejected before first write', async t => {
  for (const type of ['source', 'candidate']) {
    const f = await fixture(t);
    await writeFile(type === 'source' ? f.catalog : path.join(f.stage, 'hooks/skill-router.mjs'), 'changed');
    const before = await snapshot(f.codexRoot); let writes = 0;
    await assert.rejects(publishResourceGraph({ ...f, writer: async () => { writes++; } }), /changed|checksum/i);
    assert.equal(writes, 0); assert.deepEqual(await snapshot(f.codexRoot), before);
  }
});

test('missing or duplicated module coverage and false sidecar checksums reject a rehashed graph', async t => {
  for (const type of ['coverage', 'duplicate', 'chinese', 'description']) {
    const f = await fixture(t);
    if (type === 'coverage') delete f.graph.tools['fixture-expert'];
    if (type === 'duplicate') f.graph.tools.duplicate = f.graph.tools['fixture-expert'];
    if (type === 'chinese') f.graph.metadata.chinese_embedding.sha256 = '0'.repeat(64);
    if (type === 'description') f.graph.metadata.description_embeddings.en.sha256 = '0'.repeat(64);
    await rehashCandidate(f, 'skills.graph.json', f.graph);
    const before = await snapshot(f.codexRoot);
    await assert.rejects(publishResourceGraph({ ...f }), /coverage|duplicated|sidecar/i);
    assert.deepEqual(await snapshot(f.codexRoot), before);
  }
});

test('new owned Skill after build invalidates candidate before mutation', async t => {
  const f = await fixture(t);
  await put(f.ownedRoot, 'new/SKILL.md', '# Added after build');
  const before = await snapshot(f.codexRoot);
  await assert.rejects(publishResourceGraph(f), /Owned Skill/);
  assert.deepEqual(await snapshot(f.codexRoot), before);
});

test('mid-publish failure restores prior bytes and removes newly created files from memory', async t => {
  for (const when of ['before-commit', 'after-commit']) {
    const f = await fixture(t), before = await snapshot(f.codexRoot);
    let count = 0;
    await assert.rejects(publishResourceGraph({ ...f, writer: async (file, bytes) => {
      if (++count === 7 && when === 'before-commit') throw new Error('injected publish failure');
      await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
      if (when === 'after-commit' && file === path.join(f.registry, 'skills.graph.json')) throw new Error('injected publish failure');
    } }), /injected publish failure/);
    assert(count > 1); assert.deepEqual(await snapshot(f.codexRoot), before);
    await assert.rejects(access(path.join(f.codexRoot, 'backups')));
  }
});
