#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createReadStream } from "node:fs";

const debugEnabled = process.env.CODEX_SKILL_ROUTER_DEBUG === "1";
const MAX_SKILL_CANDIDATES = 4;
const SEMANTIC_ROUTE_THRESHOLD = 0.30;
const PER_TERM_LIMIT = 120;
const DEFAULT_RG_TIMEOUT_MS = 3000;
const GENERIC_TERMS = new Set([
  "api", "build", "config", "data", "design", "get", "helper", "list", "manage", "management",
  "operate", "operation", "page", "platform", "project", "query", "review", "search", "service",
  "short", "skill", "task", "tool", "tools", "use", "workflow", "write",
  "任务", "工具", "平台", "查看", "查询", "操作", "搜索", "数据", "服务", "流程", "管理", "获取", "配置",
  "一句", "一句话", "精简", "缩写", "摘要", "总结", "概括", "改写", "润色", "翻译", "问候", "你好", "计算", "多少", "一下", "这句话", "这一句"
]);
const cjkSegmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh", { granularity: "word" }) : null;

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
  for (let index = 0; index < pairs; index += 1) if (bytes[index * 2 + 1] === 0) oddZeros += 1;
  if (pairs >= 4 && oddZeros / pairs >= 0.4) return bytes.toString("utf16le");
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

function addToken(result, token, stopTokens) {
  const value = String(token || "").normalize("NFKC").toLocaleLowerCase().trim();
  if (!value || stopTokens.has(value)) return;
  if (/^[a-z][a-z0-9_-]{4,}s$/.test(value) && !value.endsWith("ss") && !value.endsWith("ics") && !value.endsWith("us")) result.add(value.slice(0, -1));
  result.add(value);
  for (const part of value.split(/[-_]+/)) if (part.length >= 3 && !stopTokens.has(part)) result.add(part);
}

function queryTokens(text, stopTokens) {
  const result = new Set();
  const normalized = String(text || "").normalize("NFKC").toLocaleLowerCase();
  for (const match of normalized.matchAll(/[a-z][a-z0-9_-]{1,}|\d+/g)) if (match[0].length >= 2) addToken(result, match[0], stopTokens);
  for (const run of normalized.matchAll(/[\u4e00-\u9fff]+/g)) {
    const segments = cjkSegmenter ? [...cjkSegmenter.segment(run[0])].filter((item) => item.isWordLike).map((item) => item.segment) : [];
    for (const segment of segments) if (segment.length >= 2) addToken(result, segment, stopTokens);
    // Intl.Segmenter often splits compounds such as 数据库 and 回滚 into a word plus single characters.
    for (let index = 0; index < segments.length - 1; index += 1) {
      const left = segments[index];
      const right = segments[index + 1];
      if (left.length === 1 || right.length === 1) addToken(result, `${left}${right}`, stopTokens);
    }
    if (!segments.length) for (let index = 0; index < run[0].length - 1; index += 1) addToken(result, run[0].slice(index, index + 2), stopTokens);
  }
  return [...result].filter((token) => token.length >= 2).slice(0, 100);
}

function searchTerms(tokens) {
  const informative = tokens.filter((token) => !GENERIC_TERMS.has(token) && (/[\u4e00-\u9fff]/.test(token) || token.length >= 3));
  const generic = tokens.filter((token) => GENERIC_TERMS.has(token));
  return [...new Set([...informative, ...generic])].slice(0, 8);
}

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function hasTerm(text, term) {
  const value = String(text || "").normalize("NFKC").toLocaleLowerCase();
  if (!value) return false;
  if (/[\u4e00-\u9fff]/.test(term)) return value.includes(term);
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i").test(value);
}

function exactName(query, name) {
  if (!name || name.length < 3) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(name)}([^a-z0-9]|$)`, "i").test(query);
}

function phraseMatch(query, phrase) {
  const normalizedQuery = String(query || "").normalize("NFKC").toLocaleLowerCase();
  const normalizedPhrase = String(phrase || "").normalize("NFKC").toLocaleLowerCase().trim();
  const minimumLength = /[\u4e00-\u9fff]/.test(normalizedPhrase) ? 2 : 4;
  if (normalizedPhrase.length < minimumLength || !normalizedQuery.includes(normalizedPhrase)) return false;
  return normalizedPhrase.includes(" ") || normalizedPhrase.includes("-") || /[\u4e00-\u9fff]/.test(normalizedPhrase);
}

function sourceLabel(skill) {
  const source = String(skill?.source || "unknown").toLocaleLowerCase();
  return source || "unknown";
}

function metadataKeywords(name, description) {
  const values = [...String(name || "").split(/[-_\s]+/), ...(String(description || "").toLocaleLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])];
  return [...new Set(values.filter(value => value && value.length >= 3))].slice(0, 24);
}

function isPlaceholderMetadata(...values) {
  const text = values.join(" ").normalize("NFKC").toLocaleLowerCase();
  return [
    "one sentence - what this skill does and when to invoke it",
    "what this skill does and when to use it",
    "a brief description of what this skill does",
    "one-paragraph description of what this skill does",
    "一句话——该技能的作用以及何时调用它",
    "一句话 - 这项技能的作用是什么以及何时调用它",
    "用一段话描述该技能的作用"
  ].some(placeholder => text.includes(placeholder));
}

async function projectSkillCandidates(cwd) {
  if (!cwd) return [];
  let current;
  try { current = path.resolve(cwd); } catch { return []; }
  while (current && current !== path.dirname(current)) {
    const skillsRoot = path.join(current, ".agents", "routed-skills");
    try {
      const entries = await readdir(skillsRoot, { withFileTypes: true });
      const candidates = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const skillPath = path.join(skillsRoot, entry.name, "SKILL.md");
        try {
          const body = (await readFile(skillPath, "utf8")).slice(0, 12000);
          const name = body.match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim() || entry.name;
          const description = (body.match(/^description:\s*([^\r\n]+)$/m)?.[1]?.trim() || "").replace(/\s+/g, " ").slice(0, 280);
          if (!name || !description) return null;
          return { id: `project:${name.toLocaleLowerCase()}`, name, description, keywords: metadataKeywords(name, description), path: skillPath, source: "project", rank: 0 };
        } catch { return null; }
      }));
      return candidates.filter(Boolean);
    } catch { /* Search the next parent when this directory has no project Skills. */ }
    current = path.dirname(current);
  }
  return [];
}

function skillFields(skill, aliases) {
  return [
    ["name", String(skill.name || ""), 4],
    ["alias", (aliases[String(skill.name || "").toLocaleLowerCase()] || []).join(" | "), 3.5],
    ["intent", String(skill.when || ""), 2.5],
    ["domain", String(skill.problem || ""), 2.5],
    ["tag", [skill.c1, skill.c2].filter(Boolean).join(" "), 2],
    ["keyword", Array.isArray(skill.keywords) ? skill.keywords.join(" ") : String(skill.keywords || ""), 1.2],
    ["description", String(skill.description || ""), 1]
  ];
}

function scoreSkill(skill, tokens, query, aliases, stopTokens, df, totalDocs) {
  const name = String(skill.name || "").toLocaleLowerCase();
  const fields = skillFields(skill, aliases);
  let rawScore = 0;
  const distinctive = new Set();
  const generic = new Set();
  const evidence = [];
  let matchedIntent = false;
  let matchedDomain = false;
  for (const token of tokens) {
    const matches = fields.filter(([, text]) => hasTerm(text, token));
    if (!matches.length) continue;
    const [field, , weight] = matches.sort((a, b) => b[2] - a[2])[0];
    const isGeneric = stopTokens.has(token) || GENERIC_TERMS.has(token) || Number(df.get(token) || 0) >= PER_TERM_LIMIT;
    const idf = Math.log((1 + totalDocs) / (1 + Number(df.get(token) || 0))) + 1;
    rawScore += weight * idf * (isGeneric ? 0.15 : 1);
    if (isGeneric) generic.add(token); else distinctive.add(token);
    if (field === "intent") matchedIntent = true;
    if (field === "domain" || field === "tag") matchedDomain = true;
    if (evidence.length < 5) evidence.push(`${field}:${token}`);
  }
  const aliasesForSkill = aliases[name] || [];
  const explicitName = exactName(query, name) && (name.includes("-") || /\bskill\b/i.test(query) || query.trim().toLocaleLowerCase() === name);
  const explicitAlias = aliasesForSkill.some((alias) => phraseMatch(query, alias));
  if (explicitName) { rawScore += 40; evidence.unshift("explicit-name"); }
  if (explicitAlias) { rawScore += 32; evidence.unshift("explicit-alias"); }
  const denominator = Math.max(4, Math.max(1, distinctive.size) * 3.2);
  let confidence = rawScore > 0 ? rawScore / (rawScore + denominator) : 0;
  if (explicitName) confidence = Math.max(confidence, 0.92);
  if (explicitAlias) confidence = Math.max(confidence, 0.88);
  if (distinctive.size < 2 && !explicitName && !explicitAlias && !(matchedIntent && matchedDomain)) confidence = Math.min(confidence, 0.54);
  if (distinctive.size === 0 && !explicitName && !explicitAlias) confidence = Math.min(confidence, 0.34);
  return { skill, rawScore, confidence, distinctive, generic, matchedIntent, matchedDomain, explicitName, explicitAlias, evidence: [...new Set(evidence)].slice(0, 5) };
}

function strongLocalAliasMatch(query, skills, aliases) {
  return skills.some((skill) => (aliases[String(skill.name || "").toLocaleLowerCase()] || []).some((alias) => phraseMatch(query, alias)));
}

function hasExternalIdentifierSignal(prompt, skills, aliases) {
  const text = String(prompt || "");
  const identifiers = [
    ...(text.match(/\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b/g) || []),
    ...(text.match(/\b[a-z0-9]+(?:[-_][a-z0-9]+){1,}\b/gi) || [])
  ].map(value => value.normalize("NFKC").toLocaleLowerCase());
  return identifiers.some(identifier => !skills.some(skill => skillFields(skill, aliases).some(([, value]) => hasTerm(value, identifier))));
}

function runRg(indexPath, pattern) {
  return new Promise((resolve) => {
    const args = ["--ignore-case", "--fixed-strings", "--no-heading", "--color", "never", "--max-count", String(PER_TERM_LIMIT)];
    if (/^[a-z0-9_-]+$/i.test(pattern)) args.push("--word-regexp");
    args.push("-e", pattern, "--", indexPath);
    const child = spawn("rg", args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    let timedOut = false;
    const configuredTimeout = Number.parseInt(process.env.CODEX_SKILL_ROUTER_RG_TIMEOUT_MS || String(DEFAULT_RG_TIMEOUT_MS), 10);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_RG_TIMEOUT_MS;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve({ lines: [], timedOut: true }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut || code === null) return resolve({ lines: [], timedOut: true });
      resolve({ lines: [0, 1].includes(code) ? output.split(/\r?\n/).filter(Boolean).slice(0, PER_TERM_LIMIT) : [], timedOut: false });
    });
  });
}

function runSemanticRanker(query, candidates) {
  return new Promise((resolve) => {
    const ranker = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "hooks", "semantic-ranker.mjs");
    if (!existsSync(ranker) || !process.env.CODEX_EMBEDDING_API_KEY) return resolve(new Map());
    const child = spawn(process.execPath, [ranker], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); resolve(new Map()); }, 25000);
    child.stdout.on("data", chunk => { output += chunk.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve(new Map()); });
    child.on("close", () => {
      clearTimeout(timer);
      try { const parsed = JSON.parse(output.trim() || "{}"); resolve(new Map((parsed.available ? parsed.results : []).map(item => [String(item.id), Number(item.score) || 0]))); }
      catch { resolve(new Map()); }
    });
    child.stdin.end(JSON.stringify({ query, documents: candidates.map(item => ({ id: item.id, text: item.text })), topK: candidates.length, buildMissing: false, cachePath: path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skill-registry", "semantic-index.json") }), "utf8");
  });
}

async function streamedCandidates(indexPath, patterns) {
  const lines = new Map();
  const counts = new Map(patterns.map((pattern) => [pattern, 0]));
  const reader = readline.createInterface({ input: createReadStream(indexPath, "utf8"), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line || line.startsWith("#")) continue;
    for (const pattern of patterns) {
      if (counts.get(pattern) >= PER_TERM_LIMIT || !hasTerm(line, pattern)) continue;
      counts.set(pattern, counts.get(pattern) + 1);
      lines.set(line, true);
    }
    if (patterns.every((pattern) => counts.get(pattern) >= PER_TERM_LIMIT)) break;
  }
  reader.close();
  return { lines: [...lines.keys()], counts };
}

async function externalScores(indexPath, tokens, query, aliases, stopTokens, excludedNames) {
  if (!indexPath || !existsSync(indexPath)) return [];
  const patterns = searchTerms(tokens);
  if (!patterns.length) return [];
  const started = Date.now();
  let lines;
  let counts;
  const indexBytes = (await stat(indexPath)).size;
  if (indexBytes <= 1024 * 1024) {
    ({ lines, counts } = await streamedCandidates(indexPath, patterns));
  } else {
    const results = await Promise.all(patterns.map((pattern) => runRg(indexPath, pattern)));
    if (results.some((result) => result.timedOut)) {
      ({ lines, counts } = await streamedCandidates(indexPath, patterns));
      debug("index fallback", { indexPath, patterns, lines: lines.length });
    } else {
      counts = new Map(patterns.map((pattern, index) => [pattern, results[index].lines.length]));
      lines = [...new Set(results.flatMap((result) => result.lines))];
    }
  }
  const totalDocs = Math.max(1, lines.length + (Number(process.env.CODEX_SKILL_ROUTER_EXTERNAL_DOCS) || 15471));
  const best = new Map();
  for (const line of lines) {
    const fields = line.split("\t");
    if (fields.length < 8) continue;
    const name = fields[0];
    const normalized = name.toLocaleLowerCase();
    if (excludedNames.has(normalized) || !existsSync(fields[6])) continue;
    const placeholder = isPlaceholderMetadata(fields[1], fields[2], fields[3]);
    const candidate = scoreSkill({
      id: `external:${normalized}`, name,
      description: placeholder ? "" : (fields[1] || ""), problem: placeholder ? "" : (fields[2] || ""), when: placeholder ? "" : (fields[3] || ""),
      c1: placeholder ? "" : (fields[4] || ""), c2: placeholder ? "" : (fields[5] || ""),
      keywords: [fields[7] || ""], path: fields[6], source: "external-catalog", rank: 100
    }, tokens, query, aliases, stopTokens, counts, totalDocs);
    if (candidate.rawScore <= 0) continue;
    if (!best.has(normalized) || candidate.rawScore > best.get(normalized).rawScore) best.set(normalized, candidate);
  }
  debug("index scores", { indexPath, patterns, lines: lines.length, elapsedMs: Date.now() - started, top: [...best.values()].sort((a, b) => b.rawScore - a.rawScore).slice(0, 5).map((item) => ({ name: item.skill.name, score: item.rawScore, confidence: item.confidence })) });
  return [...best.values()];
}

function selectCandidate(scored) {
  scored.sort((a, b) => b.confidence - a.confidence || b.rawScore - a.rawScore || String(a.skill.name).localeCompare(String(b.skill.name)));
  const first = scored[0];
  if (!first) return [];
  const hasEvidence = (item) => item.explicitName || item.explicitAlias || item.distinctive.size >= 2 || (item.matchedIntent && item.matchedDomain) || Number(item.semanticScore || 0) >= 0.55;
  const firstAccepted = hasEvidence(first) && first.confidence >= 0.5;
  if (!firstAccepted) {
    debug("selection", { top: first.skill.name, confidence: first.confidence, selected: [] });
    return [];
  }
  const confidenceFloor = Math.max(0.5, first.confidence * 0.72);
  const selected = scored.filter((item) => hasEvidence(item) && item.confidence >= confidenceFloor).slice(0, MAX_SKILL_CANDIDATES);
  debug("selection", { top: first.skill.name, confidence: first.confidence, confidenceFloor, selected: selected.map((item) => item.skill.name) });
  return selected;
}

function selectExplicitCandidate(scored) {
  return scored
    .filter(item => item.explicitName)
    .sort((left, right) => right.confidence - left.confidence || right.rawScore - left.rawScore)
    .slice(0, MAX_SKILL_CANDIDATES);
}

function expandProtectedSemanticSeed(ranked, relationDocument, skillByName) {
  if (!ranked.length || Number(ranked[0].semanticScore || 0) < SEMANTIC_ROUTE_THRESHOLD) return [];
  const selected = [];
  const add = (item) => {
    if (!item || selected.some(candidate => String(candidate.skill.name).toLocaleLowerCase() === String(item.skill.name).toLocaleLowerCase())) return;
    selected.push(item);
  };
  const seed = ranked[0];
  const seedName = String(seed.skill.name || "").toLocaleLowerCase();
  add(seed);
  for (const relation of Array.isArray(relationDocument?.relations) ? relationDocument.relations : []) {
    if (!Array.isArray(relation) || relation.length < 2) continue;
    const source = String(relation[0] || "").toLocaleLowerCase();
    const target = String(relation[1] || "").toLocaleLowerCase();
    const neighbour = source === seedName ? target : target === seedName ? source : "";
    if (!neighbour) continue;
    const skill = skillByName.get(neighbour);
    if (skill) add({ skill, semanticScore: 0, confidence: seed.confidence, rawScore: 0, evidence: [`graph:${relation[2] || "related"}`] });
    if (selected.length >= MAX_SKILL_CANDIDATES) break;
  }
  for (const item of ranked) {
    add(item);
    if (selected.length >= MAX_SKILL_CANDIDATES) break;
  }
  debug("semantic graph selection", { seed: seedName, score: seed.semanticScore, selected: selected.map(item => item.skill.name) });
  return selected.slice(0, MAX_SKILL_CANDIDATES);
}

try {
  const input = await readInput();
  const prompt = String(input.prompt || input.user_prompt || input.message || input.text || "").trim();
  if (input.hook_event_name !== "UserPromptSubmit" || !prompt) { process.stdout.write("{}"); process.exit(0); }
  const codexRoot = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const cwdCandidates = [input.cwd];
  if (!input.cwd || String(input.cwd).includes("?") || !existsSync(String(input.cwd))) cwdCandidates.push(process.cwd());
  const [registry, ruleDocument, relationDocument, projectSkillLists] = await Promise.all([
    readFile(path.join(codexRoot, "skill-registry", "skills-index.json"), "utf8").then(JSON.parse),
    readFile(path.join(codexRoot, "skill-registry", "routing-rules.json"), "utf8").then(JSON.parse),
    readFile(path.join(codexRoot, "skill-registry", "skill-relations.json"), "utf8").then(JSON.parse),
    Promise.all([...new Set(cwdCandidates.filter((value) => value).map((value) => String(value)))]
      .map((cwd) => projectSkillCandidates(cwd)))
  ]);
  const projectSkills = [...new Map(projectSkillLists.flat().map((skill) => [String(skill.name).toLocaleLowerCase(), skill])).values()];
  const stopTokens = new Set((ruleDocument._stopTokens || []).map((item) => String(item).toLocaleLowerCase()));
  const aliases = Object.fromEntries(Object.entries(ruleDocument).filter(([name]) => name !== "_stopTokens").map(([name, values]) => [name.toLocaleLowerCase(), (values || []).map((value) => String(value).toLocaleLowerCase())]));
  const query = prompt.normalize("NFKC").toLocaleLowerCase();
  const tokens = queryTokens(query, stopTokens);
  const skillByName = new Map();
  for (const skill of [...(Array.isArray(registry.skills) ? registry.skills : []), ...projectSkills]) {
    const key = String(skill.name || "").toLocaleLowerCase();
    if (!key) continue;
    const previous = skillByName.get(key);
    if (!previous || (skill.source === "project" && previous.source !== "project")) skillByName.set(key, skill);
  }
  const skills = [...skillByName.values()];
  const knownNames = new Set(skills.map((skill) => String(skill.name || "").toLocaleLowerCase()));
  const localAliasMatch = strongLocalAliasMatch(query, skills, aliases);
  const localScored = skills.map((skill) => scoreSkill(skill, tokens, query, aliases, stopTokens, new Map(), Math.max(1, skills.length))).filter((item) => item.rawScore > 0);
  debug("request", { prompt, cwd: input.cwd || process.cwd(), projectSkills: projectSkills.map((skill) => skill.name), tokens, localAliasMatch, localScores: localScored.length });
  let selected = selectExplicitCandidate(localScored);
  const externalEvidenceCount = tokens.filter((token) => !GENERIC_TERMS.has(token) && !stopTokens.has(token)).length;
  const externalIdentifierSignal = hasExternalIdentifierSignal(prompt, skills, aliases);
  if (!selected.length) {
    const semanticCandidates = skills.map(skill => ({ id: String(skill.id || skill.name), text: [skill.name, skill.description, skill.problem, skill.when, ...(skill.keywords || [])].filter(Boolean).join(" ") }));
    const semanticScores = await runSemanticRanker(query, semanticCandidates);
    if (semanticScores.size) {
      const ranked = skills.map(skill => {
        const semanticScore = semanticScores.get(String(skill.id || skill.name)) || 0;
        return { skill, semanticScore, confidence: semanticScore, rawScore: 0, evidence: ["semantic"] };
      }).sort((left, right) => right.semanticScore - left.semanticScore || String(left.skill.name).localeCompare(String(right.skill.name)));
      selected = expandProtectedSemanticSeed(ranked, relationDocument, skillByName);
    }
  }
  if (!selected.length) selected = selectCandidate(localScored);
  if ((!selected.length || externalIdentifierSignal) && !localAliasMatch && externalEvidenceCount >= 2) {
    const indexPaths = [registry.externalIndexPath || path.join(codexRoot, "skill-registry", "external-skills.tsv"), registry.deferredIndexPath || path.join(codexRoot, "skill-registry", "deferred-skills.tsv")].filter((value, index, values) => value && values.indexOf(value) === index);
    const indexed = await Promise.all(indexPaths.map((indexPath) => externalScores(indexPath, tokens, query, aliases, stopTokens, knownNames)));
    const externalSelected = selectCandidate(indexed.flat());
    const strongExternal = externalSelected[0] && (externalSelected[0].explicitName || externalSelected[0].explicitAlias || (externalSelected[0].confidence >= 0.75 && externalSelected[0].distinctive.size >= 2));
    if (strongExternal) selected = externalSelected;
  }
  if (!selected.length) { process.stdout.write("{}"); process.exit(0); }
  const lines = ["[CODEX_SKILL_ROUTER_V4]"];
  for (const item of selected) {
    lines.push(`- ${item.skill.name} [source=${sourceLabel(item.skill)}; confidence=${item.confidence.toFixed(2)}]`);
    lines.push(`  Read: ${item.skill.path}`);
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: lines.join("\n") } }));
} catch (error) {
  process.stderr.write(`Skill router skipped: ${error.message}\n`);
  process.stdout.write("{}");
}
