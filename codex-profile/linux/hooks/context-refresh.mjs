#!/usr/bin/env node
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

const batchingContract = `[AUTOMATIC_TOOL_BATCHING_CONTRACT_V3]
Apply this execution contract on every user turn and before every later tool wave. Do not wait for the user to request concurrency.
- Before entering tools, enumerate all currently knowable operations, separate independent work from true dependencies, and let K = min(8, the independent count).
- Use one outer \`functions.exec\` as the orchestration envelope for the largest safe phase. Run independent calls with \`Promise.all\`; when K is 5-8, the first wave must contain exactly K meaningful calls, not a 2-4 call sample.
- Keep using the same outer \`functions.exec\` for mechanically determined follow-up waves after awaited results. Poll live sessions, collect known follow-up files, and run predetermined verification there instead of returning to the model merely to plan, parse an exit code, or issue one obvious next call.
- Return to the model between waves only when semantic interpretation, a newly discovered uncertainty, user input, approval, or a destructive decision is genuinely required.
- When the user lists up to eight independent items, process every listed item in the first wave. Never serialize independent reads, searches, state checks, edits, or verification commands.
- Read a required primary Skill completely first, then batch all independent evidence checks immediately. After edits, batch all independent tests and status checks.
- Do not invent calls to fill a quota, hide dependencies, weaken checks, or claim concurrency without overlapping execution intervals.
- A phase with fewer than two independent operations may remain single-step. Otherwise, repeated one-call model-tool round trips are noncompliant.`;

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
  if (eventName === "UserPromptSubmit") parts.push("[CODEX_SKILL_ROUTER_GATE_V1]\nThe platform Skill list is metadata-only. Do not read Codex, user, project, task-tree, or external Skill bodies directly from that list. Read a SKILL.md only when the unified Skill Router names its exact path; if it names none, do not load a specialized Skill.");
  const [anchor, router] = await Promise.all([
    optionalText(path.join(codexRoot, "prompts", "global-attention-anchor.en.md")),
    optionalText(path.join(codexRoot, "prompts", "global-methodology-router.en.md"))
  ]);
  if (anchor) parts.push(`[GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3]\n${anchor}`);
  if (router) parts.push(`[GLOBAL_METHODOLOGY_ROUTER_EN_V3]\n${router}`);

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
