#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER = path.join(SCRIPT_DIR, "install-codex-profile-linux.mjs");
const LAZY_CONFIGURATOR = path.join(SCRIPT_DIR, "configure-lazy-capabilities-linux.mjs");
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

  const deferredSkill = path.join(home, ".agents", "deferred-skills", "fixture-deferred", "SKILL.md");
  await mkdir(path.dirname(deferredSkill), { recursive: true });
  await writeFile(deferredSkill, "---\nname: zephyrquartz-linux-tuning\ndescription: Diagnose ZephyrQuartz Linux latency.\n---\n");
  const refreshInput = `${JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: REPOSITORY_ROOT })}\n`;
  const refresh = run(path.join(home, ".codex", "hooks", "refresh-skill-registry.mjs"), [], { ...envArgs, input: refreshInput });
  assert(refresh.status === 0, `Linux deferred registry refresh failed: ${refresh.stderr || refresh.stdout}`);
  const deferredRouteInput = `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "Diagnose ZephyrQuartz Linux latency", cwd: REPOSITORY_ROOT })}\n`;
  const deferredRoute = run(path.join(home, ".codex", "hooks", "skill-router.mjs"), [], { ...envArgs, input: deferredRouteInput });
  const deferredRouteContext = deferredRoute.status === 0
    ? String(JSON.parse(deferredRoute.stdout).hookSpecificOutput?.additionalContext || "")
    : "";
  assert(deferredRoute.status === 0 && deferredRouteContext.includes("zephyrquartz-linux-tuning") && deferredRouteContext.includes(deferredSkill), `Linux deferred Skill route did not match: ${deferredRoute.stderr || deferredRoute.stdout}`);

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

  const lazyConfig = `[features]\nenable_mcp_apps = true\nmulti_agent = true\nplugins = true\nremote_plugin = true\n\n[plugins."documents@openai-primary-runtime"]\nenabled = true\n`;
  await writeFile(configFile, lazyConfig);
  const originalProfile = path.join(home, ".codex", "documents.config.toml");
  await writeFile(originalProfile, "sentinel = 'ORIGINAL_PROFILE'\n");
  const registryDirectory = path.join(home, ".codex", "skill-registry");
  await mkdir(registryDirectory, { recursive: true });
  const registrySentinels = new Map([
    ["skills-index.json", "ORIGINAL_SKILL_INDEX\n"],
    ["deferred-skills.tsv", "ORIGINAL_DEFERRED_INDEX\n"],
    ["routing-rules.json", "ORIGINAL_ROUTING_RULES\n"]
  ]);
  for (const [name, content] of registrySentinels) await writeFile(path.join(registryDirectory, name), content);
  const codexExtra = path.join(home, ".codex", "skills", "fixture-codex-extra", "SKILL.md");
  const agentExtra = path.join(home, ".agents", "skills", "fixture-agent-extra", "SKILL.md");
  await mkdir(path.dirname(codexExtra), { recursive: true });
  await mkdir(path.dirname(agentExtra), { recursive: true });
  await writeFile(codexExtra, "---\nname: fixture-codex-extra\ndescription: Deferred Codex fixture.\n---\n");
  await writeFile(agentExtra, "---\nname: fixture-agent-extra\ndescription: Deferred Agent fixture.\n---\n");

  const configured = run(LAZY_CONFIGURATOR, ["--home", home], { home });
  assert(configured.status === 0, `lazy capability configuration failed: ${configured.stderr || configured.stdout}`);
  const configuredText = await readFile(configFile, "utf8");
  for (const feature of ["enable_mcp_apps", "multi_agent", "plugins", "remote_plugin"]) {
    assert((configuredText.match(new RegExp(`^${feature} = false$`, "gm")) || []).length === 1, `lazy config did not set ${feature}=false exactly once`);
  }
  assert(configuredText.includes('[plugins."documents@openai-primary-runtime"]\nenabled = false'), "lazy config did not disable an existing plugin section");
  const deferredIndex = await readFile(path.join(registryDirectory, "deferred-skills.tsv"), "utf8");
  assert(deferredIndex.includes("fixture-codex-extra") && deferredIndex.includes("fixture-agent-extra"), "lazy config did not index both deferred Skill roots");
  const backupMatch = configured.stdout.match(/Backup: (.+)/);
  assert(backupMatch, `lazy config did not report its backup: ${configured.stdout}`);

  const restored = run(LAZY_CONFIGURATOR, ["--home", home, "--restore", backupMatch[1].trim()], { home });
  assert(restored.status === 0, `lazy capability restore failed: ${restored.stderr || restored.stdout}`);
  assert(await readFile(configFile, "utf8") === lazyConfig, "lazy restore did not restore config.toml");
  assert(await readFile(originalProfile, "utf8") === "sentinel = 'ORIGINAL_PROFILE'\n", "lazy restore did not restore an existing profile");
  assert(!await readFile(path.join(home, ".codex", "task-tree.config.toml")).then(() => true, () => false), "lazy restore left a generated profile behind");
  assert(await readFile(codexExtra, "utf8").then(() => true, () => false), "lazy restore did not restore a Codex Skill");
  assert(await readFile(agentExtra, "utf8").then(() => true, () => false), "lazy restore did not restore an Agent Skill");
  for (const [name, content] of registrySentinels) {
    assert(await readFile(path.join(registryDirectory, name), "utf8") === content, `lazy restore did not restore ${name}`);
  }

  const failureHome = path.join(root, "rollback-home");
  await seedHome(failureHome, "ROLLBACK_SENTINEL");
  const oldAgents = await readFile(path.join(failureHome, ".codex", "AGENTS.md"));
  const oldHooks = await readFile(path.join(failureHome, ".codex", "hooks.json"));
  const failed = run(INSTALLER, ["--home", failureHome], { home: failureHome, extraEnv: { CODEX_PROFILE_TEST_FAIL_STAGE: "post-write" } });
  assert(failed.status !== 0, "injected installation failure unexpectedly succeeded");
  assert((await readFile(path.join(failureHome, ".codex", "AGENTS.md"))).equals(oldAgents), "rollback did not restore AGENTS.md");
  assert((await readFile(path.join(failureHome, ".codex", "hooks.json"))).equals(oldHooks), "rollback did not restore hooks.json");
  assert(!await readFile(path.join(failureHome, ".codex", "prompts", "global-every-turn.en.md")).then(() => true, () => false), "rollback left a newly installed prompt behind");

  console.log("PASS: Linux portable profile install, routing, deferred indexing, lazy capability apply/restore, batching, idempotent update, check mode, and rollback.");
} finally {
  await rm(root, { recursive: true, force: true });
}
