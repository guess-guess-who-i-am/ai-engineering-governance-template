#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

const CADENCE = 3;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withSessionState(codexRoot, sessionId, update) {
  const directory = path.join(codexRoot, "hooks", "cadence-state");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(sessionId).digest("hex");
  const file = path.join(directory, `${key}.json`);
  const lock = `${file}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await mkdir(lock, { mode: 0o700 }); acquired = true; break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const age = await stat(lock).then((info) => Date.now() - info.mtimeMs).catch(() => 0);
      if (age > 5000) await rm(lock, { recursive: true, force: true });
      await pause(20);
    }
  }
  if (!acquired) throw new Error("Session cadence lock timed out");
  try {
    let state = { count: 0, lastTurnId: "", lastInclude: true };
    try { state = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const result = update(state);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
    return result;
  } finally { await rm(lock, { recursive: true, force: true }); }
}

async function includeFixedContext(codexRoot, input, eventName) {
  const sessionId = String(input.session_id || "").trim();
  if (!sessionId) return true; // No stable identity: never silently suppress reminders.
  try {
    if (eventName === "SessionStart") {
      await withSessionState(codexRoot, sessionId, (state) => {
        state.count = 0;
        state.lastTurnId = "";
        state.lastInclude = true;
      });
      return true;
    }
    const turnId = String(input.turn_id || "").trim();
    return await withSessionState(codexRoot, sessionId, (state) => {
      if (turnId && state.lastTurnId === turnId) return Boolean(state.lastInclude);
      state.count = (Number.isSafeInteger(state.count) && state.count >= 0 ? state.count : 0) + 1;
      state.lastTurnId = turnId;
      state.lastInclude = (state.count - 1) % CADENCE === 0;
      return state.lastInclude;
    });
  } catch (error) {
    process.stderr.write(`Cadence state unavailable; injecting fixed reminders: ${error.message}\n`);
    return true;
  }
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
- Start ordinary read-only waves at min(4, the number of ready independent operations). Request the same initial width from a native batched API when it exposes that option. Increase width gradually only after successful low-contention waves; halve it after failures, timeouts, rate limits, or resource contention. Never exceed 20.
- Execute only ready DAG nodes in each wave. Keep stateful, destructive, rate-limited, approval-gated, uncertain, or mutually interfering operations at concurrency 1 unless the owning interface explicitly guarantees safe parallelism.
- Use one outer \`functions.exec\` when it reduces model round trips, and use \`Promise.all\` only for operations proven independent. Continue mechanically determined polling, collection, and verification inside that envelope.
- Use only tools actually exposed in this session. If the host exposes only a shell, run independent ready commands through the installed Node DAG runner at \`~/.codex/tools/parallel-run.mjs\`; pass \`-\` and pipe a JSON plan on stdin when writes are forbidden. Do not issue one model round trip per ready command or assume \`functions.exec\` exists. Each task has \`id\`, \`command\`, \`args\`, \`dependsOn\`, and \`safety\`; omit irrelevant optional values.
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
  const includeFixed = await includeFixedContext(codexRoot, input, eventName);
  if (eventName === 'UserPromptSubmit' && !includeFixed) parts.push('[ADAPTIVE_TOOL_SCHEDULING_CONTRACT_V4] Batch independent ready reads using tools actually available; shell-only sessions can execute ~/.codex/tools/parallel-run.mjs. Start at 4, grow after success, halve on contention; 20 is a ceiling, not a target. Preserve dependencies and serial safety; do not invent work.');
  if (includeFixed) {
    if (eventName === "UserPromptSubmit") parts.push(batchingContract);
    const [anchor, router] = await Promise.all([
      optionalText(path.join(codexRoot, "prompts", "global-attention-anchor.en.md")),
      optionalText(path.join(codexRoot, "prompts", "global-methodology-router.en.md"))
    ]);
    if (anchor) parts.push(`[GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3]\n${anchor}`);
    if (router) parts.push(`[GLOBAL_METHODOLOGY_ROUTER_EN_V3]\n${router}`);
  }
  const cwd = typeof input.cwd === "string" && existsSync(input.cwd) ? input.cwd : process.cwd();
  if (includeFixed && (findProjectFile(cwd, "task-tree.md") || findProjectFile(cwd, "task-trees.json"))) {
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
