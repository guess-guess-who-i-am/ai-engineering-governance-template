#!/usr/bin/env node
import { createHash } from "node:crypto";
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

try {
  for await (const _chunk of process.stdin) { /* Consume Hook input. */ }
  const home = os.homedir();
  const codexRoot = process.env.CODEX_HOME || path.join(home, ".codex");
  const root = path.join(home, ".agents", "skills");
  const files = await skillFiles(root);
  const skills = await Promise.all(files.map(async (file) => {
    const text = await readFile(file, "utf8");
    const name = frontmatterValue(text, "name");
    const description = frontmatterValue(text, "description").replace(/\s+/g, " ");
    return {
      id: `agents:${name.toLocaleLowerCase()}`,
      name,
      description: description.slice(0, 280),
      path: file,
      source: "agents",
      sha256: createHash("sha256").update(text).digest("hex")
    };
  }));
  const registryDirectory = path.join(codexRoot, "skill-registry");
  await mkdir(registryDirectory, { recursive: true });
  const registryPath = path.join(registryDirectory, "skills-index.json");
  const temporary = `${registryPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schemaVersion: "codex-user-skill-registry/1",
    generatedAt: new Date().toISOString(),
    roots: [{ source: "agents", path: root }],
    skillCount: skills.length,
    skills
  }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, registryPath);
  process.stdout.write("{}");
} catch (error) {
  process.stderr.write(`Skill registry refresh skipped: ${error.message}\n`);
  process.stdout.write("{}");
}
