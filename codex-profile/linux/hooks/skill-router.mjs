#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ownedSkills = [
  "manage-global-methodology",
  "method-research-evidence",
  "method-engineering-execution",
  "method-evaluation-gates",
  "method-github-delivery",
  "method-task-tree"
];

async function readInput() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try { return JSON.parse(text || "{}"); } catch { return {}; }
}

function descriptionFromFrontmatter(text) {
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/);
  return frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

try {
  const input = await readInput();
  if (input.hook_event_name !== "UserPromptSubmit" || typeof input.prompt !== "string" || !input.prompt.trim()) {
    process.stdout.write("{}");
    process.exit(0);
  }
  const home = os.homedir();
  const codexRoot = process.env.CODEX_HOME || path.join(home, ".codex");
  const rules = JSON.parse(await readFile(path.join(codexRoot, "skill-registry", "routing-rules.json"), "utf8"));
  const prompt = input.prompt.toLocaleLowerCase();
  const selected = ownedSkills.filter((name) =>
    Array.isArray(rules[name]) && rules[name].some((term) => prompt.includes(String(term).toLocaleLowerCase()))
  ).slice(0, 4);
  if (!selected.length) {
    process.stdout.write("{}");
    process.exit(0);
  }
  const candidates = await Promise.all(selected.map(async (name) => {
    const skillPath = path.join(home, ".agents", "skills", name, "SKILL.md");
    const text = await readFile(skillPath, "utf8");
    return { name, skillPath, description: descriptionFromFrontmatter(text) };
  }));
  const lines = [
    "[GLOBAL_SKILL_ROUTER_V1]",
    "Potentially relevant user-owned Skills are listed from a lightweight intent index. Read a Skill in full only if it directly applies; do not preload the others.",
    ...candidates.map(({ name, skillPath, description }) => `- ${name}: ${description} Path: ${skillPath}`)
  ];
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: lines.join("\n") }
  }));
} catch (error) {
  process.stderr.write(`Skill router skipped: ${error.message}\n`);
  process.stdout.write("{}");
}
