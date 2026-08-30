#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir, readFile, rename, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

function indexField(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function metadataKeywords(name, description) {
  const values = [...String(name || "").split(/[-_\s]+/), ...(String(description || "").toLocaleLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])];
  return [...new Set(values.filter(value => value && value.length >= 3))].slice(0, 24);
}

function buildSemanticIndex(ranker, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ranker], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 55000);
    child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
    child.on("error", error => { clearTimeout(timer); resolve(error.message); });
    child.on("close", code => { clearTimeout(timer); resolve(code === 0 ? "" : stderr || `exit ${code}`); });
    child.stdin.end(JSON.stringify(input), "utf8");
  });
}

try {
  const inputChunks = [];
  for await (const chunk of process.stdin) inputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  let hookInput = {};
  try { hookInput = JSON.parse(Buffer.concat(inputChunks).toString("utf8") || "{}"); } catch { /* No project cwd available. */ }
  const home = os.homedir();
  const codexRoot = process.env.CODEX_HOME || path.join(home, ".codex");
  const roots = [
    { source: "codex", rank: 10, root: path.join(codexRoot, "skills") },
    { source: "agents", rank: 20, root: path.join(home, ".agents", "routed-skills") }
  ];
  let current = hookInput.cwd ? path.resolve(String(hookInput.cwd)) : "";
  while (current && current !== path.dirname(current)) {
    const projectRoot = path.join(current, ".agents", "routed-skills");
    if ((await skillFiles(projectRoot)).length) { roots.push({ source: "project", rank: 0, root: projectRoot }); break; }
    current = path.dirname(current);
  }
  const entries = (await Promise.all(roots.map(async root => (await skillFiles(root.root)).map(file => ({ ...root, file }))))).flat();
  const loaded = await Promise.all(entries.map(async ({ source, rank, root, file }) => {
    const text = await readFile(file, "utf8");
    const name = frontmatterValue(text, "name");
    const description = frontmatterValue(text, "description").replace(/\s+/g, " ").slice(0, 280);
    return {
      id: `${source}:${name.toLocaleLowerCase()}`,
      name,
      description,
      keywords: metadataKeywords(name, description),
      path: file,
      source,
      rank,
      sha256: createHash("sha256").update(text).digest("hex")
    };
  }));
  const byName = new Map();
  for (const skill of loaded) {
    const key = skill.name.toLocaleLowerCase();
    const previous = byName.get(key);
    if (!previous || skill.rank < previous.rank) byName.set(key, skill);
  }
  const skills = [...byName.values()];
  const registryDirectory = path.join(codexRoot, "skill-registry");
  await mkdir(registryDirectory, { recursive: true });
  const deferredRoots = [
    path.join(codexRoot, "deferred-skills", "codex"),
    path.join(home, ".agents", "deferred-skills")
  ];
  const deferredFiles = (await Promise.all(deferredRoots.map(skillFiles))).flat().sort();
  const deferredLines = await Promise.all(deferredFiles.map(async (file) => {
    const text = await readFile(file, "utf8");
    const name = indexField(frontmatterValue(text, "name") || path.basename(path.dirname(file)));
    const description = indexField(frontmatterValue(text, "description"));
    return [name, description, "", "", "", "", indexField(file), "deferred"].join("\t");
  }));
  const deferredIndexPath = path.join(registryDirectory, "deferred-skills.tsv");
  const deferredTemporary = `${deferredIndexPath}.${process.pid}.tmp`;
  await writeFile(deferredTemporary, `# codex-deferred-skill-index/1\n${deferredLines.join("\n")}${deferredLines.length ? "\n" : ""}`, { mode: 0o600 });
  await rename(deferredTemporary, deferredIndexPath);
  const registryPath = path.join(registryDirectory, "skills-index.json");
  const temporary = `${registryPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schemaVersion: "codex-user-skill-registry/1",
    generatedAt: new Date().toISOString(),
    roots: roots.map(item => ({ source: item.source, rank: item.rank, path: item.root })),
    skillCount: skills.length,
    deferredSkillCount: deferredFiles.length,
    deferredIndexPath,
    skills
  }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, registryPath);
  const semanticRanker = path.join(codexRoot, "hooks", "semantic-ranker.mjs");
  if ((process.env.CODEX_EMBEDDING_API_KEY || process.env.AGICTO_API_KEY)) {
    const error = await buildSemanticIndex(semanticRanker, {
      buildOnly: true,
      buildMissing: true,
      documents: skills.map(skill => ({ id: skill.id, text: [skill.name, skill.description, ...(skill.keywords || [])].filter(Boolean).join(" ") })),
      cachePath: path.join(registryDirectory, "semantic-index.json")
    });
    if (error) process.stderr.write(`Local Skill semantic index refresh skipped: ${error}\n`);
  }
  process.stdout.write("{}");
} catch (error) {
  process.stderr.write(`Skill registry refresh skipped: ${error.message}\n`);
  process.stdout.write("{}");
}
