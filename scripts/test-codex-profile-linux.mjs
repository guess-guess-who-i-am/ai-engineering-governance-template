#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER = path.join(SCRIPT_DIR, "install-codex-profile-linux.mjs");
const REPOSITORY_ROOT = path.dirname(SCRIPT_DIR);

function hash(data) { return createHash("sha256").update(data).digest("hex"); }

function run(file, args, { home, input = "", extraEnv = {} } = {}) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    input,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), ...extraEnv }
  });
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function latestBackup(home) {
  const root = path.join(home, ".codex", "backups", "portable-profile");
  const names = await readdir(root);
  names.sort();
  return path.join(root, names.at(-1));
}

async function seedHome(home, marker) {
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await writeFile(path.join(home, ".codex", "AGENTS.md"), `${marker}\n`);
  await writeFile(path.join(home, ".codex", "hooks.json"), `${JSON.stringify({ old: marker })}\n`);
  await writeFile(path.join(home, ".codex", "auth.json"), `${JSON.stringify({ sentinel: marker })}\n`);
  await writeFile(path.join(home, ".codex", "config.toml"), `sentinel = "${marker}"\n`);
}

const root = await mkdtemp(path.join(os.tmpdir(), "codex-profile-linux-test-"));
try {
  const home = path.join(root, "home with spaces");
  await seedHome(home, "KEEP_CUSTOM_CONFIGURATION");
  const authFile = path.join(home, ".codex", "auth.json");
  const configFile = path.join(home, ".codex", "config.toml");
  const authBefore = hash(await readFile(authFile));
  const configBefore = hash(await readFile(configFile));

  const install = run(INSTALLER, ["--home", home, "--json"], { home });
  assert(install.status === 0, `clean install failed: ${install.stderr || install.stdout}`);
  const result = JSON.parse(install.stdout);
  assert(result.status === "installed" && result.changedFiles > 0, "installer did not report a real installation");
  assert(hash(await readFile(authFile)) === authBefore, "installer changed auth.json");
  assert(hash(await readFile(configFile)) === configBefore, "installer changed config.toml");

  const agents = await readFile(path.join(home, ".codex", "AGENTS.md"), "utf8");
  assert(agents.includes("KEEP_CUSTOM_CONFIGURATION"), "existing AGENTS.md content was lost");
  assert((agents.match(/ai-engineering-governance-template:begin/g) || []).length === 1, "managed AGENTS.md block is missing or duplicated");
  const hooks = JSON.parse(await readFile(path.join(home, ".codex", "hooks.json"), "utf8"));
  assert(hooks.hooks.UserPromptSubmit[0].hooks.length === 1 && hooks.hooks.SessionStart[0].hooks.length === 1, "hooks.json does not use one stable dispatcher per event");
  const hookCommand = hooks.hooks.UserPromptSubmit[0].hooks[0].command;
  assert(hookCommand.includes(process.execPath) && hookCommand.includes("hook-dispatch.mjs"), "hooks.json does not pin the absolute Node executable and dispatcher path");
  const targets = JSON.parse(await readFile(path.join(home, ".codex", "prompt-publisher", "methodology-targets.json"), "utf8"));
  assert(targets.validatorFile.endsWith("validate-methodology-routing.mjs"), "Linux publisher still targets the PowerShell validator");
  assert(targets.refreshRegistryFile.endsWith("refresh-skill-registry.mjs"), "Linux publisher still targets the PowerShell registry refresher");

  const backup = await latestBackup(home);
  const manifest = JSON.parse(await readFile(path.join(backup, "manifest.json"), "utf8"));
  assert(manifest.files.some((item) => item.destination.endsWith(path.join(".codex", "AGENTS.md")) && item.existed), "backup manifest does not record the previous AGENTS.md");
  assert(manifest.files.some((item) => item.destination.endsWith(path.join(".codex", "hooks.json")) && item.existed), "backup manifest does not record the previous hooks.json");

  const envArgs = { home };
  const validator = run(path.join(home, ".codex", "hooks", "validate-methodology-routing.mjs"), [], envArgs);
  assert(validator.status === 0 && validator.stdout.includes("PASS: 63 English rules"), `63-rule validation failed: ${validator.stderr || validator.stdout}`);
  const contextInput = `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello", cwd: REPOSITORY_ROOT })}\n`;
  const dispatcher = path.join(home, ".codex", "hooks", "hook-dispatch.mjs");
  const context = run(dispatcher, [], { ...envArgs, input: contextInput });
  const contextPayload = JSON.parse(context.stdout);
  const contextText = String(contextPayload.hookSpecificOutput.additionalContext);
  assert(context.status === 0 && contextText.startsWith("[AUTOMATIC_TOOL_BATCHING_CONTRACT_V3]") && contextText.includes("mechanically determined follow-up waves"), "automatic batching contract is absent, not first, or weakened");
  const routeInput = `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "Please push this release to GitHub", cwd: REPOSITORY_ROOT })}\n`;
  const routed = run(dispatcher, [], { ...envArgs, input: routeInput });
  assert(routed.status === 0 && routed.stdout.includes("method-github-delivery"), `GitHub methodology route did not match: ${routed.stderr || routed.stdout}`);
  const unrelated = run(path.join(home, ".codex", "hooks", "skill-router.mjs"), [], { ...envArgs, input: `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello", cwd: REPOSITORY_ROOT })}\n` });
  assert(unrelated.status === 0 && unrelated.stdout.trim() === "{}", "unrelated prompt received a methodology recommendation");

  const fixtureDirectory = path.join(root, "dispatcher-fixtures");
  await mkdir(fixtureDirectory, { recursive: true });
  const fixtureFiles = [];
  for (const name of ["alpha", "beta"]) {
    const file = path.join(fixtureDirectory, `${name}.mjs`);
    await writeFile(file, `const started=Date.now(); await new Promise((resolve) => setTimeout(resolve, 600)); const ended=Date.now(); process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:"${name}:"+started+":"+ended}}));\n`);
    fixtureFiles.push(file);
  }
  const parallel = run(dispatcher, [], {
    ...envArgs,
    input: contextInput,
    extraEnv: {
      CODEX_HOOK_DISPATCH_TEST_MODE: "1",
      CODEX_HOOK_DISPATCH_HANDLERS_JSON: JSON.stringify(fixtureFiles)
    }
  });
  assert(parallel.status === 0 && parallel.stdout.includes("alpha") && parallel.stdout.includes("beta"), "dispatcher did not merge both fixture Hooks");
  const intervals = [...parallel.stdout.matchAll(/(?:alpha|beta):(\d+):(\d+)/g)].map((match) => ({ start: Number(match[1]), end: Number(match[2]) }));
  assert(intervals.length === 2, `dispatcher did not expose two timing intervals: ${parallel.stdout}`);
  assert(Math.max(...intervals.map((item) => item.start)) < Math.min(...intervals.map((item) => item.end)), `dispatcher child intervals did not overlap: ${JSON.stringify(intervals)}`);

  const reinstall = run(INSTALLER, ["--home", home, "--json"], { home });
  assert(reinstall.status === 0, `repeat install failed: ${reinstall.stderr || reinstall.stdout}`);
  const agentsAfter = await readFile(path.join(home, ".codex", "AGENTS.md"), "utf8");
  assert((agentsAfter.match(/ai-engineering-governance-template:begin/g) || []).length === 1, "repeat install duplicated the managed AGENTS.md block");
  const check = run(INSTALLER, ["--home", home, "--check", "--json"], { home });
  assert(check.status === 0 && JSON.parse(check.stdout).status === "current", `--check failed: ${check.stderr || check.stdout}`);

  const failureHome = path.join(root, "rollback-home");
  await seedHome(failureHome, "ROLLBACK_SENTINEL");
  const oldAgents = await readFile(path.join(failureHome, ".codex", "AGENTS.md"));
  const oldHooks = await readFile(path.join(failureHome, ".codex", "hooks.json"));
  const failed = run(INSTALLER, ["--home", failureHome], { home: failureHome, extraEnv: { CODEX_PROFILE_TEST_FAIL_STAGE: "post-write" } });
  assert(failed.status !== 0, "injected installation failure unexpectedly succeeded");
  assert((await readFile(path.join(failureHome, ".codex", "AGENTS.md"))).equals(oldAgents), "rollback did not restore AGENTS.md");
  assert((await readFile(path.join(failureHome, ".codex", "hooks.json"))).equals(oldHooks), "rollback did not restore hooks.json");
  assert(!await readFile(path.join(failureHome, ".codex", "prompts", "global-every-turn.en.md")).then(() => true, () => false), "rollback left a newly installed prompt behind");

  console.log("PASS: Linux portable profile install, merge, manifest backup, credential isolation, 63-rule validation, routing, batching, idempotent update, check mode, and rollback.");
} finally {
  await rm(root, { recursive: true, force: true });
}
