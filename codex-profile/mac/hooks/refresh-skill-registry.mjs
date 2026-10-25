#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readdir, readFile, rename, writeFile, mkdir, stat, realpath, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createReadStream, openSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configuredServers, discover } from './mcp-catalog.mjs';
import { skillFiles, graphInputsHash } from './registry-inputs.mjs';

function frontmatterValue(text, key) {
  const block = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || "";
  return block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

async function exists(directory) {
  try { await access(directory); return true; }
  catch { return false; }
}

async function externalCatalogPaths(home, codexRoot) {
  const configuredRoot = process.env.CODEX_EXTERNAL_SKILL_ROOT;
  const configuredCatalog = process.env.CODEX_EXTERNAL_SKILL_CATALOG;
  let installedConfig = {};
  try { installedConfig = JSON.parse(await readFile(path.join(codexRoot, "skill-registry", "external-library-config.json"), "utf8")); } catch { /* Optional configuration. */ }
  let root = configuredRoot || process.env.CODEX_PROFILE_SKILL_ROOT || installedConfig.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "skills");
  let catalog = configuredCatalog || installedConfig.catalog || path.join(root, "_catalog_cn.json");
  try { root = await realpath(root); } catch { /* Keep missing configuration observable. */ }
  try { catalog = await realpath(catalog); } catch { /* Missing catalog is handled by the caller. */ }
  const graphIndex = path.join(codexRoot, "skill-registry", "skills.graph.json");
  const graphManifest = path.join(codexRoot, "skill-registry", "skills.graph.manifest.json");
  const graphIndexer = path.join(codexRoot, "hooks", "graph_skill_index.py");
  const graphPython = process.env.CODEX_GRAPH_TOOL_PYTHON || path.join(codexRoot, "tools", "graph-tool-call-venv", ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
  const mcpCatalog = path.join(codexRoot, "skill-registry", "mcp-tools.json");
  const resourceCatalog = path.join(codexRoot, "skill-registry", "resource-modules.json");
  const ownedRoot = path.join(home, ".agents", "skills");
  return { root, catalog, graphIndex, graphManifest, graphIndexer, graphPython, mcpCatalog, resourceCatalog, ownedRoot,
    chineseEmbedding: installedConfig.chineseEmbedding || '',
    requireComplete: installedConfig.requireComplete === true };
}

async function listMcpTools(codexRoot, outputPath) {
  const configPath = path.join(codexRoot, "config.toml");
  let text;
  try { text = await readFile(configPath, "utf8"); } catch { return { tools: [] }; }
  const python = process.env.CODEX_GRAPH_TOOL_PYTHON || path.join(codexRoot, 'tools/graph-tool-call-venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
  const servers = await configuredServers(configPath, python);
  const results = await Promise.allSettled(servers.map(server => discover(server)));
  const failed = results.map((r, i) => r.status === 'rejected' ? servers[i].name : null).filter(Boolean);
  if (failed.length) throw new Error(`MCP discovery incomplete; preserving the previous index: ${failed.join(', ')}`);
  const tools = results.flatMap(result => result.value);
  const data = { schemaVersion: "codex-mcp-tool-catalog/1", generatedAt: new Date().toISOString(), tools };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return data;
}

async function refreshExternalIndex(home, codexRoot) {
  const { root, catalog, graphIndex, graphManifest, graphIndexer, graphPython, mcpCatalog, resourceCatalog, ownedRoot, requireComplete, chineseEmbedding } = await externalCatalogPaths(home, codexRoot);
  if (!await exists(root) || !await exists(catalog)) return null;

  if (!await exists(graphPython) || !await exists(graphIndexer)) {
    throw new Error(`GraphToolCall runtime is missing: ${graphPython}`);
  }

  const sourceStat = await stat(catalog);
  const sourceHash = await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(catalog);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
  const manifestPath = path.join(codexRoot, "skill-registry", "external-skills-manifest.json");
  let mcpCatalogData = null;
  mcpCatalogData = await listMcpTools(codexRoot, mcpCatalog);
  const inputsHash = await graphInputsHash(ownedRoot, mcpCatalogData.tools || [], resourceCatalog);
  try {
    const current = JSON.parse(await readFile(manifestPath, "utf8"));
    if (current.schemaVersion === "graph-tool-call-skills/1" && current.catalogPath === catalog &&
        current.rootPath === root && current.catalogLength === sourceStat.size &&
        current.catalogMtimeMs === sourceStat.mtimeMs && current.catalogSha256 === sourceHash && current.embedding === "sentence-transformers/all-MiniLM-L6-v2" &&
        current.graphPath === graphIndex && current.graphInputsSha256 === inputsHash && (current.chineseEmbedding || '') === chineseEmbedding &&
        (!requireComplete || (!current.missingSkillCount && !current.invalidSkillCount)) &&
        await exists(graphIndex) && await exists(mcpCatalog)) return current;
  } catch { /* Rebuild a missing or stale index. */ }

  await mkdir(path.dirname(graphIndex), { recursive: true });
  const args = [graphIndexer, "build", "--root", root, "--catalog", catalog, "--output", graphIndex, "--mcp-catalog", mcpCatalog, "--owned-root", ownedRoot, "--embedding"];
  if (await exists(resourceCatalog)) args.push("--resource-catalog", resourceCatalog);
  if (requireComplete) args.push("--require-complete");
  if (chineseEmbedding) args.push('--chinese-embedding', chineseEmbedding);
  const child = spawn(graphPython, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (Number(exitCode) !== 0) throw new Error(`GraphToolCall indexing failed (${exitCode}): ${stderr || stdout}`);
  const built = JSON.parse(stdout.trim());
  const manifest = {
    ...built,
    schemaVersion: "graph-tool-call-skills/1",
    catalogPath: catalog,
    rootPath: root,
    catalogLength: sourceStat.size,
    catalogMtimeMs: sourceStat.mtimeMs,
    catalogSha256: sourceHash,
    graphInputsSha256: inputsHash,
    graphPath: graphIndex,
    graphManifestPath: graphManifest,
    indexerPath: graphIndexer,
    pythonPath: graphPython
  };
  const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryManifest, manifestPath);
  return manifest;
}

function keywords(name, description) {
  return [...new Set(`${name} ${description}`.toLocaleLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])].slice(0, 24);
}

try {
  for await (const _chunk of process.stdin) { /* Drain Hook input before rebuilding the global index. */ }
  if (process.env.CODEX_SKIP_EXTERNAL_INDEX_REFRESH === "1") {
    process.stdout.write("{}");
    process.exit(0);
  }
  const home = os.homedir();
  const codexRoot = process.env.CODEX_HOME || path.join(home, ".codex");
  if (process.env.CODEX_SKILL_REGISTRY_FOREGROUND !== "1") {
    const config = await externalCatalogPaths(home, codexRoot);
    await mkdir(path.join(codexRoot, "skill-registry"), { recursive: true, mode: 0o700 });
    const log = openSync(path.join(codexRoot, "skill-registry", "refresh.log"), "a", 0o600);
    try {
      const child = spawn(config.graphPython, [config.graphIndexer, "refresh",
        "--lock", path.join(codexRoot, "skill-registry", "refresh.lock"),
        "--node", process.execPath, "--script", fileURLToPath(import.meta.url)], {
        detached: true, stdio: ["ignore", log, log], env: process.env
      });
      child.on("error", (error) => process.stderr.write(`Background Skill refresh failed: ${error.message}\n`));
      child.unref();
    } finally { closeSync(log); }
    process.stdout.write("{}");
    process.exit(0);
  }
  const roots = [
    { source: "codex", rank: 10, path: path.join(codexRoot, "skills") },
    { source: "agents", rank: 20, path: path.join(home, ".agents", "skills") },
    { source: "orchestra", rank: 30, path: path.join(home, ".orchestra", "skills") }
  ];
  for (const marketplace of [path.join(codexRoot, "plugins", "cache"), path.join(home, ".codex", "plugins", "cache")]) {
    roots.push({ source: "plugin-cache", rank: 40, path: marketplace });
  }
  const externalConfig = await externalCatalogPaths(home, codexRoot);
  if (await exists(externalConfig.root)) roots.push({ source: "external-library", rank: 50, path: externalConfig.root });
  const uniqueRoots = [];
  const seenRoots = new Set();
  for (const root of roots) {
    if (!root.path || seenRoots.has(root.path) || !await exists(root.path)) continue;
    seenRoots.add(root.path);
    uniqueRoots.push(root);
  }
  const externalManifest = await refreshExternalIndex(home, codexRoot);
  // The external catalog is already indexed by refreshExternalIndex. Keep the
  // per-Hook registry small instead of mirroring 15k+ graph nodes into JSON.
  const discovered = await Promise.all(uniqueRoots.filter((root) => root.source !== "external-library")
    .map(async (root) => ({ root, files: await skillFiles(root.path) })));
  const skills = (await Promise.all(discovered.flatMap(({ root, files }) => files.map(async (file) => {
    const [text, metadata] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const name = frontmatterValue(text, "name");
    const description = frontmatterValue(text, "description").replace(/\s+/g, " ").trim();
    if (!name || !description) return null;
    return {
      id: `${root.source}:${name.toLocaleLowerCase()}`,
      name,
      description: description.slice(0, 280),
      keywords: keywords(name, description),
      path: file,
      source: root.source,
      rank: root.rank,
      bytes: metadata.size,
      sha256: createHash("sha256").update(text).digest("hex")
    };
  })))).filter(Boolean);
  const registryDirectory = path.join(codexRoot, "skill-registry");
  await mkdir(registryDirectory, { recursive: true });
  const registryPath = path.join(registryDirectory, "skills-index.json");
  const temporary = `${registryPath}.${process.pid}.tmp`;
  const registryHandle = await open(temporary, "w", 0o600);
  await registryHandle.writeFile(`${JSON.stringify({
    schemaVersion: "codex-skill-registry/2",
    generatedAt: new Date().toISOString(),
    roots: uniqueRoots,
    skillCount: skills.length,
    externalSkillCount: externalManifest?.externalSkillCount || externalManifest?.skillCount || 0,
    ownedSkillCount: externalManifest?.ownedSkillCount || 0,
    resourceModuleCount: externalManifest?.resourceModuleCount || 0,
    externalMissingSkillCount: externalManifest?.missingSkillCount || 0,
    externalGraphPath: externalManifest?.graphPath || path.join(codexRoot, "skill-registry", "skills.graph.json"),
    skills
  }, null, 2)}\n`);
  await registryHandle.sync();
  await registryHandle.close();
  await rename(temporary, registryPath);
  process.stdout.write("{}");
} catch (error) {
  process.stderr.write(`Skill registry refresh skipped: ${error.message}\n`);
  process.stdout.write("{}");
  if (process.env.CODEX_SKILL_REGISTRY_FOREGROUND === '1') process.exitCode = 1;
}
