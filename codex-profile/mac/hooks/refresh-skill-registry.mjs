#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readdir, readFile, rename, writeFile, mkdir, stat } from "node:fs/promises";
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

async function exists(directory) {
  try { await access(directory); return true; }
  catch { return false; }
}

function keywords(name, description) {
  return [...new Set(`${name} ${description}`.toLocaleLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])].slice(0, 24);
}

try {
  for await (const _chunk of process.stdin) { /* Drain Hook input before rebuilding the global index. */ }
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
  const uniqueRoots = [];
  const seenRoots = new Set();
  for (const root of roots) {
    if (!root.path || seenRoots.has(root.path) || !await exists(root.path)) continue;
    seenRoots.add(root.path);
    uniqueRoots.push(root);
  }
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
  await writeFile(temporary, `${JSON.stringify({
    schemaVersion: "codex-skill-registry/2",
    generatedAt: new Date().toISOString(),
    roots: uniqueRoots,
    skillCount: skills.length,
    skills
  }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, registryPath);
  process.stdout.write("{}");
} catch (error) {
  process.stderr.write(`Skill registry refresh skipped: ${error.message}\n`);
  process.stdout.write("{}");
}
