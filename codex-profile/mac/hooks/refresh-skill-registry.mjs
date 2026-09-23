#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readdir, readFile, rename, writeFile, mkdir, stat, realpath, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";

async function skillFiles(root) {
  const result = [];
  async function visit(directory) {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    await Promise.all(entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name === "SKILL.md") result.push(target);
    }));
  }
  await visit(root);
  return result.sort();
}

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
  const graphPython = process.env.CODEX_GRAPH_TOOL_PYTHON || path.join(codexRoot, "tools", "graph-tool-call-venv", "bin", "python");
  return { root, catalog, graphIndex, graphManifest, graphIndexer, graphPython };
}

async function refreshExternalIndex(home, codexRoot) {
  const { root, catalog, graphIndex, graphManifest, graphIndexer, graphPython } = await externalCatalogPaths(home, codexRoot);
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
  try {
    const current = JSON.parse(await readFile(manifestPath, "utf8"));
    if (current.schemaVersion === "graph-tool-call-skills/1" && current.catalogPath === catalog &&
        current.rootPath === root && current.catalogLength === sourceStat.size &&
        current.catalogMtimeMs === sourceStat.mtimeMs && current.catalogSha256 === sourceHash && current.embedding === "sentence-transformers/all-MiniLM-L6-v2" &&
        current.graphPath === graphIndex && await exists(graphIndex)) return current;
  } catch { /* Rebuild a missing or stale index. */ }

  await mkdir(path.dirname(graphIndex), { recursive: true });
  const args = [graphIndexer, "build", "--root", root, "--catalog", catalog, "--output", graphIndex, "--embedding"];
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
  const discovered = await Promise.all(uniqueRoots.map(async (root) => ({ root, files: await skillFiles(root.path) })));
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
    externalSkillCount: externalManifest?.skillCount || 0,
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
}
