#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.dirname(SCRIPT_DIR);
const TASK_TREE_REPOSITORY = "https://github.com/guess-guess-who-i-am/llm-task-tree.git";

function parseArgs(argv) {
  const options = { home: os.homedir(), check: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--home") options.home = argv[++index];
    else if (arg === "--check") options.check = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.home) throw new Error("--home requires a path");
  options.home = path.resolve(options.home);
  return options;
}

async function exists(file) {
  try { await access(file); return true; }
  catch { return false; }
}

function run(command, args, { cwd = REPOSITORY_ROOT, env = process.env, input = "", timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: Number(code), stdout, stderr }); });
    child.stdin.end(input);
  });
}

function runtimeCandidates(home) {
  return [
    process.env.TASK_TREE_RUNTIME_ROOT,
    path.resolve(REPOSITORY_ROOT, "..", "llm-task-tree-macos", "llm-task-tree-kit"),
    path.resolve(REPOSITORY_ROOT, "..", "llm-task-tree", "llm-task-tree-kit"),
    path.join(home, ".codex", "tools", "llm-task-tree", "llm-task-tree-kit")
  ].filter(Boolean);
}

async function validRuntime(root) {
  return await exists(path.join(root, "scripts", "mcp-server.mjs")) &&
    await exists(path.join(root, "scripts", "install-codex-mcp.mjs"));
}

async function findRuntime(home) {
  for (const candidate of runtimeCandidates(home)) {
    if (await validRuntime(candidate)) return path.resolve(candidate);
  }
  return "";
}

async function cloneRuntime(home) {
  const toolsRoot = path.join(home, ".codex", "tools");
  const checkout = path.join(toolsRoot, "llm-task-tree");
  const temporary = `${checkout}.install-${process.pid}`;
  await mkdir(toolsRoot, { recursive: true, mode: 0o700 });
  await rm(temporary, { recursive: true, force: true });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const clone = await run("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", TASK_TREE_REPOSITORY, temporary], { env, timeoutMs: 180000 });
  if (clone.code !== 0) throw new Error(`task-tree runtime clone failed: ${clone.stderr.trim() || clone.stdout.trim()}`);
  const sparse = await run("git", ["-C", temporary, "sparse-checkout", "set", "llm-task-tree-kit"], { env, timeoutMs: 120000 });
  if (sparse.code !== 0) throw new Error(`task-tree sparse checkout failed: ${sparse.stderr.trim() || sparse.stdout.trim()}`);
  await rm(checkout, { recursive: true, force: true });
  await rename(temporary, checkout);
  const runtime = path.join(checkout, "llm-task-tree-kit");
  if (!await validRuntime(runtime)) throw new Error(`cloned task-tree runtime is incomplete: ${runtime}`);
  return runtime;
}

function configBlock(text, header) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return [];
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end += 1;
  return lines.slice(start, end);
}

async function verifyConfig(home, entry) {
  const configFile = path.join(home, ".codex", "config.toml");
  const text = await readFile(configFile, "utf8");
  const mcp = configBlock(text, "[mcp_servers.task_tree]").join("\n");
  const features = configBlock(text, "[features]").join("\n");
  if (!mcp.includes(`command = '${process.execPath}'`) || !mcp.includes(`args = ['${entry}']`)) {
    throw new Error("global task_tree MCP registration is absent or points at another runtime");
  }
  if (!/^enable_mcp_apps\s*=\s*true$/m.test(features)) throw new Error("features.enable_mcp_apps is not enabled");
}

async function verifyProtocol(entry) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mac-profile-check", version: "1" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" }
  ];
  const result = await run(process.execPath, [entry], { input: `${requests.map(JSON.stringify).join("\n")}\n`, timeoutMs: 30000 });
  if (result.code !== 0) throw new Error(`task_tree MCP protocol check failed: ${result.stderr.trim()}`);
  const responses = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const tools = responses.find((item) => item.id === 2)?.result?.tools || [];
  if (!tools.some((tool) => tool.name === "task_tree_focus") || !tools.some((tool) => tool.name === "task_tree_write")) {
    throw new Error("task_tree MCP did not advertise focus and write tools");
  }
  return tools.length;
}

async function install(options) {
  let runtime = await findRuntime(options.home);
  let runtimeAction = "reused";
  if (!runtime) {
    if (options.check) throw new Error("task-tree runtime is missing; run the one-click deployment while GitHub is reachable");
    runtime = await cloneRuntime(options.home);
    runtimeAction = "cloned";
  }
  const entry = path.join(runtime, "scripts", "mcp-server.mjs");
  const codexHome = path.join(options.home, ".codex");
  if (!options.check) {
    const registration = await run(process.execPath, [
      path.join(runtime, "scripts", "install-codex-mcp.mjs"),
      "--entry", entry,
      "--codex-home", codexHome
    ], { timeoutMs: 30000 });
    if (registration.code !== 0) throw new Error(`task_tree MCP registration failed: ${registration.stderr.trim() || registration.stdout.trim()}`);
  }
  await verifyConfig(options.home, entry);
  const toolCount = await verifyProtocol(entry);
  return { status: options.check ? "current" : "installed", runtimeAction, runtime, entry, toolCount };
}

const options = parseArgs(process.argv.slice(2));
install(options).then((result) => {
  if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    console.log(`Task-tree MCP: ${result.status} (${result.runtimeAction} runtime)`);
    console.log(`Task-tree tools verified: ${result.toolCount}`);
  }
}).catch((error) => {
  console.error(`Task-tree MCP installation failed: ${error.message}`);
  process.exitCode = 1;
});
