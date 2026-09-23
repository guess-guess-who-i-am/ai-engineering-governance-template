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
  const mcpCatalog = path.join(codexRoot, "skill-registry", "mcp-tools.json");
  const ownedRoot = path.join(home, ".agents", "skills");
  return { root, catalog, graphIndex, graphManifest, graphIndexer, graphPython, mcpCatalog, ownedRoot };
}

function parseMcpServers(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const servers = [];
  let current = null;
  for (const line of lines) {
    const section = line.match(/^\s*\[mcp_servers\.([^\]]+)\]\s*$/);
    if (section) { current = { name: section[1], command: "", args: [], env: {} }; servers.push(current); continue; }
    if (!current) continue;
    const command = line.match(/^\s*command\s*=\s*["'](.*)["']\s*$/);
    if (command) current.command = command[1];
    const args = line.match(/^\s*args\s*=\s*\[(.*)\]\s*$/);
    if (args) current.args = [...args[1].matchAll(/["']([^"']*)["']/g)].map((m) => m[1]);
  }
  return servers.filter((server) => server.command);
}

async function listMcpTools(codexRoot, outputPath) {
  const configPath = path.join(codexRoot, "config.toml");
  let text;
  try { text = await readFile(configPath, "utf8"); } catch { return { tools: [] }; }
  const tools = [];
  for (const server of parseMcpServers(text)) {
    const payload = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex-global-indexer", version: "1" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
    ].map(JSON.stringify).join("\n") + "\n";
    const result = await new Promise((resolve) => {
      const child = spawn(server.command, server.args, { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = ""; const timer = setTimeout(() => { child.kill(); resolve({ code: -1, stdout }); }, 20000);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.on("error", () => { clearTimeout(timer); resolve({ code: -1, stdout }); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout }); });
      child.stdin.end(payload);
    });
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      try {
        const response = JSON.parse(line);
        if (response.id !== 2) continue;
        for (const tool of response.result?.tools || []) tools.push({ ...tool, name: tool.name, tool_name: `mcp_${server.name}_${tool.name}`, server: server.name });
      } catch { /* Ignore non-JSON server logs. */ }
    }
  }
  const data = { schemaVersion: "codex-mcp-tool-catalog/1", generatedAt: new Date().toISOString(), tools };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return data;
}

async function refreshExternalIndex(home, codexRoot) {
  const { root, catalog, graphIndex, graphManifest, graphIndexer, graphPython, mcpCatalog, ownedRoot } = await externalCatalogPaths(home, codexRoot);
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
  try { mcpCatalogData = await listMcpTools(codexRoot, mcpCatalog); } catch { mcpCatalogData = { tools: [] }; }
  try {
    const current = JSON.parse(await readFile(manifestPath, "utf8"));
    if (current.schemaVersion === "graph-tool-call-skills/1" && current.catalogPath === catalog &&
        current.rootPath === root && current.catalogLength === sourceStat.size &&
        current.catalogMtimeMs === sourceStat.mtimeMs && current.catalogSha256 === sourceHash && current.embedding === "sentence-transformers/all-MiniLM-L6-v2" &&
        current.graphPath === graphIndex && current.mcpToolCount === (mcpCatalogData.tools || []).length && current.ownedSkillCount === (await skillFiles(ownedRoot)).length && await exists(graphIndex) && await exists(mcpCatalog)) return current;
  } catch { /* Rebuild a missing or stale index. */ }

  await mkdir(path.dirname(graphIndex), { recursive: true });
  const args = [graphIndexer, "build", "--root", root, "--catalog", catalog, "--output", graphIndex, "--mcp-catalog", mcpCatalog, "--owned-root", ownedRoot, "--embedding"];
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
    externalSkillCount: externalManifest?.externalSkillCount || externalManifest?.skillCount || 0,
    ownedSkillCount: externalManifest?.ownedSkillCount || 0,
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
