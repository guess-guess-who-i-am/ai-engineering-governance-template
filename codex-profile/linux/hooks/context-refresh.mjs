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

const batchingContract = `[AUTOMATIC_TOOL_BATCHING_CONTRACT_V6]
Default execution policy for every user turn and every later tool wave: collect all safe operations whose inputs are already known, mark the real dependencies, then execute one complete batch before returning to reasoning.
- If 2 or more operations are independent, the next assistant tool message MUST contain every known operation together (up to 8); prefer 5–8 when that many are already known. Use the actual tool name exposed in this conversation and never invent a wrapper name.
- When the platform accepts parallel tool calls, emit 5–8 separate calls in the same message so they can overlap; never split a known batch into serial probes or wait for the user to request concurrency.
- When only one shell/command tool is exposed, start the independent commands concurrently inside that one command (for example PowerShell \`ForEach-Object -Parallel -ThrottleLimit 8\`, \`Start-Job\`, or Node \`Promise.all\`) and wait for all results. Do not use a sequential \`foreach\` for independent work.
- Use the actual operations you know, never invented filler. Keep mechanically determined follow-up polls, reads, and checks in the same batch wave. Return for interpretation only when a true dependency, uncertainty, user input, approval, or destructive decision requires it.
- This policy applies equally to reads, searches, state checks, edits, tests, and MCP/tool requests that can safely overlap. Do not claim concurrency unless the operations overlap in execution.`;

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
  if (eventName === "UserPromptSubmit") parts.push("[RESPONSE_LENGTH_GATE_V4]\nHard acceptance check before sending: every ordinary answer, including search, research, comparison, recommendation, audit, and debugging summaries, MUST be <=300 total visible characters (including punctuation, Markdown, URLs, and English). Count the complete rendered text and rewrite until within the limit. Keep only the direct conclusion, decisive evidence/actions, verification status, and material limitations; use one compact paragraph or at most 3 short bullets. For searches, stop once decision-changing evidence is sufficient and cite at most 1–2 short source links; never dump source pages or lengthy comparisons. If a search tool fails or approval is unavailable, state the evidence gap within the same limit. Do not send an over-limit draft. Exceed 300 characters only when the user explicitly requests detail, a complete derivation, or step-by-step explanation.");

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
