#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createReadStream } from "node:fs";

const debugEnabled = process.env.CODEX_SKILL_ROUTER_DEBUG === "1";
function debug(label, value) {
  if (!debugEnabled) return;
  process.stderr.write(`[skill-router] ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = decodeInput(Buffer.concat(chunks));
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function decodeInput(bytes) {
  if (!bytes.length) return "";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2, bytes.length - (bytes.length % 2)));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  const pairs = Math.min(Math.floor(bytes.length / 2), 128);
  let oddZeros = 0;
  for (let index = 0; index < pairs; index += 1) {
    if (bytes[index * 2 + 1] === 0) oddZeros += 1;
  }
  if (pairs >= 4 && oddZeros / pairs >= 0.4) return bytes.toString("utf16le");
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

function queryTokens(text, stopTokens) {
  const result = new Set();
  const normalized = text.toLocaleLowerCase();
  for (const match of normalized.matchAll(/[a-z][a-z0-9_-]{1,}|\d+/g)) {
    if (match[0].length >= 2 && !stopTokens.has(match[0])) result.add(match[0]);
  }
  for (const run of normalized.matchAll(/[\u4e00-\u9fff]+/g)) {
    for (let index = 0; index < run[0].length; index += 1) {
      for (const size of [2, 3]) {
        const token = run[0].slice(index, index + size);
        if (token.length === size && !stopTokens.has(token)) result.add(token);
      }
    }
  }
  return [...result].slice(0, 100);
}

function exactName(query, name) {
  if (!name || name.length < 3) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(query);
}

function scoreSkill(skill, tokens, query, aliases) {
  const name = String(skill.name || "").toLocaleLowerCase();
  const haystack = `${skill.name || ""} ${skill.description || ""} ${(skill.keywords || []).join(" ")}`.toLocaleLowerCase();
  let score = 0;
  const matches = [];
  for (const token of tokens) {
    if (!haystack.includes(token)) continue;
    score += token.length >= 4 ? 3 : 1;
    if (name.includes(token)) score += token.length >= 4 ? 6 : 2;
    if (matches.length < 3) matches.push(token);
  }
  if (exactName(query, name)) { score += 24; matches.push("exact name"); }
  for (const alias of aliases[name] || []) {
    if (query.includes(alias.toLocaleLowerCase())) { score += 12; if (matches.length < 3) matches.push(alias); }
  }
  return { skill, score, matches: [...new Set(matches)].slice(0, 3) };
}

function rgCandidates(indexPath, patterns) {
  return new Promise((resolve) => {
    const args = ["--ignore-case", "--fixed-strings", "--no-heading", "--color", "never", "--max-count", "300"];
    for (const pattern of patterns) args.push("-e", pattern);
    args.push("--", indexPath);
    const child = spawn("rg", args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    let timedOut = false;
    const configuredTimeout = Number.parseInt(process.env.CODEX_SKILL_ROUTER_RG_TIMEOUT_MS || "3000", 10);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 3000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut || code === null) {
        resolve(null);
        return;
      }
      resolve([0, 1].includes(code) ? output.split(/\r?\n/).filter(Boolean).slice(0, 300) : null);
    });
  });
}

async function streamedCandidates(indexPath, patterns) {
  const lines = [];
  const reader = readline.createInterface({ input: createReadStream(indexPath, "utf8"), crlfDelay: Infinity });
  for await (const line of reader) {
    const lower = line.toLocaleLowerCase();
    if (patterns.some((pattern) => lower.includes(pattern.toLocaleLowerCase()))) lines.push(line);
    if (lines.length >= 300) break;
  }
  reader.close();
  return lines;
}

async function externalScores(indexPath, tokens, query, aliases, excludedNames) {
  if (!indexPath || !existsSync(indexPath)) {
    debug("missing index", indexPath || "<empty>");
    return [];
  }
  const patterns = [...new Set(tokens.filter((token) => token.length >= 3).sort((a, b) => b.length - a.length))].slice(0, 16);
  if (!patterns.length) return [];
  const lines = await rgCandidates(indexPath, patterns) || await streamedCandidates(indexPath, patterns);
  debug("index candidates", { indexPath, patterns, lines: lines.length });
  const best = new Map();
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length < 8) continue;
    const name = fields[0];
    const normalized = name.toLocaleLowerCase();
    if (excludedNames.has(normalized) || !existsSync(fields[6])) continue;
    const candidate = scoreSkill({
      id: `external:${normalized}`,
      name,
      description: fields[1] || fields[2] || fields[3],
      keywords: [fields[4], fields[5], fields[7]],
      path: fields[6],
      source: "external-catalog",
      rank: 100
    }, tokens, query, aliases);
    if (candidate.score <= 0) continue;
    if (!best.has(normalized) || candidate.score > best.get(normalized).score) best.set(normalized, candidate);
  }
  const results = [...best.values()];
  debug("index scores", results.map((item) => ({ name: item.skill.name, score: item.score })));
  return results;
}

try {
  const input = await readInput();
  const prompt = String(input.prompt || input.user_prompt || input.message || input.text || "").trim();
  if (input.hook_event_name !== "UserPromptSubmit" || !prompt) {
    process.stdout.write("{}");
    process.exit(0);
  }
  const codexRoot = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const [registry, ruleDocument] = await Promise.all([
    readFile(path.join(codexRoot, "skill-registry", "skills-index.json"), "utf8").then(JSON.parse),
    readFile(path.join(codexRoot, "skill-registry", "routing-rules.json"), "utf8").then(JSON.parse)
  ]);
  const stopTokens = new Set((ruleDocument._stopTokens || []).map((item) => String(item).toLocaleLowerCase()));
  const aliases = Object.fromEntries(Object.entries(ruleDocument)
    .filter(([name]) => name !== "_stopTokens")
    .map(([name, values]) => [name.toLocaleLowerCase(), (values || []).map((value) => String(value).toLocaleLowerCase())]));
  const query = prompt.toLocaleLowerCase();
  const tokens = queryTokens(query, stopTokens);
  const skills = Array.isArray(registry.skills) ? registry.skills : [];
  const knownNames = new Set(skills.map((skill) => String(skill.name || "").toLocaleLowerCase()));
  const localAliasMatch = [...knownNames].some((name) => (aliases[name] || []).some((alias) => query.includes(alias)));
  const scored = skills.map((skill) => scoreSkill(skill, tokens, query, aliases)).filter((item) => item.score > 0);
  debug("request", { prompt, codexRoot, tokens, localAliasMatch, localScores: scored.length });
  if (!localAliasMatch) {
    const indexPaths = [
      registry.externalIndexPath || path.join(codexRoot, "skill-registry", "external-skills.tsv"),
      registry.deferredIndexPath || path.join(codexRoot, "skill-registry", "deferred-skills.tsv")
    ].filter((value, index, values) => value && values.indexOf(value) === index);
    debug("index paths", indexPaths);
    const indexed = await Promise.all(indexPaths.map((indexPath) => externalScores(
      indexPath, tokens, query, aliases, knownNames
    )));
    scored.push(...indexed.flat());
  }
  scored.sort((a, b) => b.score - a.score || Number(a.skill.rank || 0) - Number(b.skill.rank || 0) || String(a.skill.name).localeCompare(String(b.skill.name)));
  debug("top scores", scored.slice(0, 6).map((item) => ({ name: item.skill.name, score: item.score })));
  if (!scored.length || scored[0].score < 6) {
    process.stdout.write("{}");
    process.exit(0);
  }
  const minimum = Math.max(6, Math.floor(scored[0].score * 0.55));
  const selected = scored.filter((item) => item.score >= minimum).slice(0, 4);
  const lines = [
    "[CODEX_SKILL_ROUTER_V2]",
    "Assistive routing only: read a full SKILL.md only when it directly applies to the latest request; do not load the whole Skill catalog.",
    "Candidates:"
  ];
  for (const item of selected) {
    const description = String(item.skill.description || "").replace(/\s+/g, " ").trim().slice(0, 280);
    lines.push(`- ${item.skill.name} [score=${item.score}; match=${item.matches.join(", ") || "description match"}]`);
    lines.push(`  ${description}`);
    lines.push(`  Read: ${item.skill.path}`);
  }
  lines.push("If none is genuinely relevant, ignore this list and continue without a specialized Skill.");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: lines.join("\n") }
  }));
} catch (error) {
  process.stderr.write(`Skill router skipped: ${error.message}\n`);
  process.stdout.write("{}");
}
