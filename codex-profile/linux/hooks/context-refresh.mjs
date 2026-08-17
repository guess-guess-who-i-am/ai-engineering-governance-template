#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function readInput() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try { return JSON.parse(text || "{}"); } catch { return {}; }
}

async function optionalText(file) {
  try { return (await readFile(file, "utf8")).replace(/^\uFEFF/, "").trim(); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

function findProjectFile(startDirectory, fileName) {
  let current = path.resolve(startDirectory);
  while (true) {
    const candidate = path.join(current, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

const batchingContract = `[AUTOMATIC_TOOL_BATCHING_CONTRACT_V2]
Apply this execution contract on every user turn. Do not wait for the user to request concurrency.
- Before each tool phase, partition the next operations into independent and dependent groups.
- Front-load the phase: before the first tool action, enumerate and count all currently knowable independent operations. Let K = min(8, that count). Do not split known work into repeated small batches merely to return to the model and think again.
- If K is 2-4, the next tool action MUST use one outer \`functions.exec\` with \`Promise.all\` containing all K operations. If K is 5-8, it MUST contain exactly K meaningful nested calls; a 2-4 call batch is noncompliant when at least five independent operations are already known.
- When the user explicitly lists up to eight independent items to inspect, read, search, or verify, process every listed item in the first batch. Do not take a sample and return for another reasoning round.
- Never serialize independent reads, searches, state checks, or verifications. Do not invent calls to meet a quota or combine dependent, interactive, approval-sensitive, or destructive work into the batch.
- Read any required primary Skill completely first; immediately afterward, batch all independent evidence and project-state checks. Do not return to the model between operations whose inputs are already known.
- Analyze each batch once, then batch the next independent phase. Keep dependent, interactive, approval-sensitive, and destructive operations sequential.
- A turn with fewer than two independent tool operations may remain single-step. Do not chain unrelated shell commands or weaken required checks.
- Never present sequential tool calls as concurrency or use sequential calls to imitate a concurrent batch.
- UI or output return order is not evidence of concurrency; determine concurrency from the operations' actual start and end times and require overlapping execution intervals.`;

try {
  const input = await readInput();
  const eventName = String(input.hook_event_name || "");
  if (!new Set(["UserPromptSubmit", "SessionStart"]).has(eventName)) {
    process.stdout.write("{}");
    process.exit(0);
  }
  if (eventName === "SessionStart" && !new Set(["startup", "resume", "clear", "compact"]).has(String(input.source || ""))) {
    process.stdout.write("{}");
    process.exit(0);
  }

  const codexRoot = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const parts = [];
  const [anchor, router] = await Promise.all([
    optionalText(path.join(codexRoot, "prompts", "global-attention-anchor.en.md")),
    optionalText(path.join(codexRoot, "prompts", "global-methodology-router.en.md"))
  ]);
  if (anchor) parts.push(`[GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3]\n${anchor}`);
  if (router) parts.push(`[GLOBAL_METHODOLOGY_ROUTER_EN_V3]\n${router}`);

  const cwd = typeof input.cwd === "string" && existsSync(input.cwd) ? input.cwd : process.cwd();
  if (findProjectFile(cwd, "task-tree.md") || findProjectFile(cwd, "task-trees.json")) {
    parts.push("Deterministic route: task-tree state exists. Load `method-task-tree` before acting, call `task_tree_focus`, and apply the nearest project `AGENTS.md`. The latest user request overrides stale graph focus; `GraphState.NextPlan` is never executable.");
  }
  if (eventName === "SessionStart" && input.source === "compact") {
    parts.push("Compaction recovery: restore the active task, selected methodology routes, applicable `AGENTS.md` files, repository state, evidence, and first unresolved gap before continuing. Do not load the complete methodology archive; reload only the routes that still apply.");
  }
  if (eventName === "UserPromptSubmit") parts.push(batchingContract);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: parts.join("\n\n") }
  }));
} catch (error) {
  process.stderr.write(`Context refresh hook skipped: ${error.message}\n`);
  process.stdout.write("{}");
}
