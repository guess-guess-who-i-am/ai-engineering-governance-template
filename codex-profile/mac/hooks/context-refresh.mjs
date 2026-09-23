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

const batchingContract = `[ADAPTIVE_TOOL_SCHEDULING_CONTRACT_V4]
Apply this execution contract on every user turn and before every later tool wave. Twenty is a hard safety ceiling, never a utilization target.
- First build the smallest useful dependency DAG: identify prerequisites, independent branches, shared mutable state, rate limits, destructive effects, and the result that each consumer actually needs.
- Prefer one native batched tool request for homogeneous reads or searches. Do not open extra terminals when a multi-query API, one bounded command, or one shared process can perform the same independent work.
- Start ordinary read-only waves at 2-4 concurrent operations. Increase width gradually only after successful low-contention waves; halve it after failures, timeouts, rate limits, or resource contention. Never exceed 20.
- Execute only ready DAG nodes in each wave. Keep stateful, destructive, rate-limited, approval-gated, uncertain, or mutually interfering operations at concurrency 1 unless the owning interface explicitly guarantees safe parallelism.
- Use one outer \`functions.exec\` when it reduces model round trips, and use \`Promise.all\` only for operations proven independent. Continue mechanically determined polling, collection, and verification inside that envelope.
- Return to the model when results require semantic interpretation, the graph changes, uncertainty appears, user input is required, or a destructive decision must be made.
- Read a required primary Skill completely first. After edits, batch independent checks, but preserve producer-consumer order and run the narrowest evidence capable of falsifying the claim.
- Record wave membership, concurrency width, timings, exit codes, retries, timeouts, and skipped dependency consumers. Real overlap is evidence; a configured maximum is not.
- Do not invent work to fill capacity, split one efficient operation into many terminals, hide dependencies, weaken checks, or claim concurrency without overlapping execution intervals.`;

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
  if (eventName === "UserPromptSubmit") parts.push(batchingContract);
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
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: parts.join("\n\n") }
  }));
} catch (error) {
  process.stderr.write(`Context refresh hook skipped: ${error.message}\n`);
  process.stdout.write("{}");
}
