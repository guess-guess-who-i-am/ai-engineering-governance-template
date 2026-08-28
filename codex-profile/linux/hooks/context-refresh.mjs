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

const batchingContract = `[AUTOMATIC_TOOL_BATCHING_CONTRACT_V4]
This is mandatory on every user turn and before every later tool wave; never wait for the user to request concurrency.
- Before the first tool call, enumerate every currently knowable safe operation, mark true dependencies, and set K = min(8, the number of safe independent operations).
- If K >= 2, the first wave MUST be one outer \`functions.exec\` call whose JavaScript uses \`Promise.all\` for all K operations. Sending only one or two of several known independent operations is noncompliant; do not use a small trial batch.
- If K is 3 or 4, submit all 3 or 4. If K is 5–8, submit exactly K. If K = 1, a single call is allowed. Never invent work to reach a quota.
- Keep the same outer \`functions.exec\` alive for mechanically determined follow-up waves: poll live sessions, collect known follow-up files, and run predetermined checks there instead of returning to the model merely to parse an exit code or issue one obvious next call.
- Return to the model between waves only for semantic interpretation, new uncertainty, user input, approval, or a destructive decision that genuinely requires it.
- Batch every independent read, search, state check, edit, and verification command. Read a required primary Skill completely first; then immediately batch all independent evidence checks. After edits, batch all independent tests and status checks.
- Do not serialize independent operations, hide dependencies, weaken checks, or claim concurrency without overlapping execution intervals.`;

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
