#!/usr/bin/env node
// Narrow PreToolUse guard: reject obvious sequential loops over independent targets.
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let input = {};
try { input = JSON.parse(raw || "{}"); } catch { process.stdout.write("{}"); process.exit(0); }
if (String(input.hook_event_name || "") !== "PreToolUse") { process.stdout.write("{}"); process.exit(0); }
const toolName = String(input.tool_name || input.toolName || "").toLowerCase();
const toolInput = input.tool_input ?? input.toolInput ?? input.input ?? {};
let command = typeof toolInput === "string" ? toolInput : String(toolInput?.command ?? toolInput?.cmd ?? toolInput?.script ?? "");
const loop = /\bforeach\s*\(|\bforeach\s+\(|ForEach-Object(?!\s+-Parallel)|\bfor\s*\(/i.test(command);
const parallel = /-Parallel\b|Promise\.all\s*\(|Promise\.allSettled\s*\(|Start-Job\b|Start-ThreadJob\b|xargs\s+-P\b|&\s*$/i.test(command);
const targets = (command.match(/(?:[A-Za-z]:\\|\.\/|\.\\|\/)[^'"\s,;\)]+|['"][^'"]+['"]/g) || []).length;
const relevantTool = toolName.includes("exec") || toolName.includes("bash") || toolName.includes("shell") || toolName === "commandexecution";
if (relevantTool && loop && !parallel && targets >= 3) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", additionalContext: "This command serializes a loop over multiple independent targets. Do not execute it. Rewrite the same operation as one concurrent batch (Promise.all/Promise.allSettled, PowerShell ForEach-Object -Parallel, Start-Job/Start-ThreadJob, or native parallel tool calls), then retry. Preserve all targets and results." } }));
else process.stdout.write("{}");
