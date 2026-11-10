#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function readInput() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let parsed = {};
  try { parsed = JSON.parse(raw || "{}"); } catch { /* Individual handlers will receive the original input. */ }
  return { raw: raw || "{}", parsed };
}

function invocation(file) {
  const extension = path.extname(file).toLowerCase();
  if ([".js", ".cjs", ".mjs"].includes(extension)) return { command: process.execPath, args: [file] };
  if (extension === ".ps1") {
    const command = process.platform === "win32"
      ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "pwsh";
    return { command, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file] };
  }
  throw new Error(`Unsupported Hook script: ${file}`);
}

function runHandler(handler, input) {
  return new Promise((resolve) => {
    const call = invocation(handler.file);
    const child = spawn(call.command, call.args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, file: handler.file, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ context: "", error: `timed out after ${handler.timeoutMs}ms` });
    }, handler.timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); finish({ context: "", error: error.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (Number(code) !== 0) return finish({ context: "", error: `exited with code ${code}` });
      try {
        const output = JSON.parse(stdout.trim() || "{}");
        finish({ context: String(output?.hookSpecificOutput?.additionalContext || ""), error: "" });
      } catch (error) {
        finish({ context: "", error: `returned invalid JSON: ${error.message}` });
      }
    });
    child.stdin.end(input, "utf8");
  });
}

function testHandlers() {
  if (process.env.CODEX_HOOK_DISPATCH_TEST_MODE !== "1" || !process.env.CODEX_HOOK_DISPATCH_HANDLERS_JSON) return null;
  const files = JSON.parse(process.env.CODEX_HOOK_DISPATCH_HANDLERS_JSON);
  if (!Array.isArray(files)) throw new Error("CODEX_HOOK_DISPATCH_HANDLERS_JSON must be an array");
  return files.map((file) => ({ file: path.resolve(String(file)), timeoutMs: 5000 }));
}

function defaultHandlers(eventName, codexRoot) {
  const own = (name, timeoutMs) => {
    const nodeHandler = path.join(codexRoot, "hooks", `${name}.mjs`);
    const powerShellHandler = path.join(codexRoot, "hooks", `${name}.ps1`);
    const file = existsSync(nodeHandler) ? nodeHandler : powerShellHandler;
    return { file, timeoutMs };
  };
  const handlers = eventName === "UserPromptSubmit"
    ? [own("context-refresh", 7000), own("skill-router", 12000)]
    : eventName === "SessionStart"
      ? [own("context-refresh", 7000), own("refresh-skill-registry", 65000)]
      : [];

  const external = eventName === "UserPromptSubmit"
    ? process.env.CODEX_CAPABILITY_HOOK || (process.platform === "win32" ? "E:\\能力归纳概括\\capability-router\\hooks\\capability-router.ps1" : "")
    : process.env.CODEX_CAPABILITY_REFRESH_HOOK || (process.platform === "win32" ? "E:\\能力归纳概括\\capability-router\\hooks\\refresh-capability-registry.ps1" : "");
  if (external) handlers.push({ file: external, timeoutMs: eventName === "UserPromptSubmit" ? 12000 : 30000 });
  return handlers.filter((handler) => existsSync(handler.file));
}

try {
  const { raw, parsed } = await readInput();
  const eventName = String(parsed.hook_event_name || "");
  if (!new Set(["UserPromptSubmit", "SessionStart"]).has(eventName)) {
    process.stdout.write("{}");
    process.exit(0);
  }
  const codexRoot = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const handlers = testHandlers() || defaultHandlers(eventName, codexRoot);
  const results = await Promise.all(handlers.map((handler) => runHandler(handler, raw)));
  for (const result of results) {
    if (result.error || result.stderr.trim()) {
      process.stderr.write(`Hook dispatcher child ${result.file}: ${result.error || result.stderr.trim()}\n`);
    }
  }
  const contexts = results.map((result) => result.context.trim()).filter(Boolean);
  if (!contexts.length) process.stdout.write("{}");
  else process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: contexts.join("\n\n") }
  }));
} catch (error) {
  process.stderr.write(`Hook dispatcher skipped: ${error.message}\n`);
  process.stdout.write("{}");
}
