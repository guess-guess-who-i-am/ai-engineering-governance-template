#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER = path.join(SCRIPT_DIR, "install-codex-profile-mac.mjs");
const DEPLOYER = path.join(SCRIPT_DIR, "deploy-codex-profile-mac.sh");
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

function runShell(file, args, { home, input = "", extraEnv = {} } = {}) {
  return spawnSync("/bin/sh", [file, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    input,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), ...extraEnv }
  });
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
  const systemSkill = path.join(home, ".codex", "skills", ".system", "skill-installer");
  await mkdir(systemSkill, { recursive: true });
  await writeFile(path.join(systemSkill, "SKILL.md"), "---\nname: skill-installer\ndescription: Install skills from a curated list or repository path.\n---\nfixture\n");
}

const root = await mkdtemp(path.join(os.tmpdir(), "codex-profile-mac-test-"));
try {
  const home = path.join(root, "home with spaces");
  await seedHome(home, "KEEP_CUSTOM_CONFIGURATION");
  const authFile = path.join(home, ".codex", "auth.json");
  const configFile = path.join(home, ".codex", "config.toml");
  const authBefore = hash(await readFile(authFile));

  const install = run(INSTALLER, ["--home", home, "--json"], { home });
  assert(install.status === 0, `clean install failed: ${install.stderr || install.stdout}`);
  const result = JSON.parse(install.stdout);
  assert(result.status === "installed" && result.changedFiles > 0, "installer did not report a real installation");
  assert(hash(await readFile(authFile)) === authBefore, "installer changed auth.json");
  const config = await readFile(configFile, "utf8");
  assert(config.includes('sentinel = "KEEP_CUSTOM_CONFIGURATION"'), "installer removed unrelated config.toml content");
  assert(config.includes('web_search = "live"'), "installer did not enable live web search");
  assert(config.includes("hooks = true") && config.includes("multi_agent = true"), "installer did not enable Hooks and multi-agent");
  assert(config.includes("enabled = true") && config.includes("max_concurrent_threads_per_session = 20"), "installer did not configure 20 concurrent agents");

  const agents = await readFile(path.join(home, ".codex", "AGENTS.md"), "utf8");
  assert(agents.includes("KEEP_CUSTOM_CONFIGURATION"), "existing AGENTS.md content was lost");
  assert((agents.match(/ai-engineering-governance-template:begin/g) || []).length === 1, "managed AGENTS.md block is missing or duplicated");
  const hooks = JSON.parse(await readFile(path.join(home, ".codex", "hooks.json"), "utf8"));
  assert(hooks.hooks.UserPromptSubmit[0].hooks.length === 1 && hooks.hooks.SessionStart[0].hooks.length === 1, "hooks.json does not use one stable dispatcher per event");
  const hookCommand = hooks.hooks.UserPromptSubmit[0].hooks[0].command;
  assert(hookCommand.includes(process.execPath) && hookCommand.includes("hook-dispatch.mjs"), "hooks.json does not pin the absolute Node executable and dispatcher path");
  const targets = JSON.parse(await readFile(path.join(home, ".codex", "prompt-publisher", "methodology-targets.json"), "utf8"));
  assert(targets.validatorFile.endsWith("validate-methodology-routing.mjs"), "macOS publisher still targets the PowerShell validator");
  assert(targets.refreshRegistryFile.endsWith("refresh-skill-registry.mjs"), "macOS publisher still targets the PowerShell registry refresher");
  assert(targets.routes.filter((route) => route.skillFile).every((route) => route.skillFile === `../../.agents/skills/${route.id}/SKILL.md`), "installed publisher does not target global Skills");
  const expectedSkills = [
    "manage-global-methodology", "method-engineering-execution", "method-evaluation-gates",
    "method-github-delivery", "method-research-evidence", "method-task-tree",
    "build-designed-interface", "clarify-before-build", "establish-test-strategy",
    "evolve-contracts", "fix-regression-with-tdd", "model-project-domain",
    "review-governance-framework", "review-project-diff", "start-new-project",
    "systematic-debugging", "verify-before-completion", "write-pr-description",
    "task-tree-chain-run", "task-tree-core-state", "task-tree-grill", "task-tree-subtree-run"
  ];
  for (const name of expectedSkills) {
    const skill = await readFile(path.join(home, ".agents", "skills", name, "SKILL.md"), "utf8");
    assert(skill.includes(`name: ${name}`), `global Skill ${name} is missing or has invalid frontmatter`);
  }

  const backup = await latestBackup(home);
  const manifest = JSON.parse(await readFile(path.join(backup, "manifest.json"), "utf8"));
  assert(manifest.files.some((item) => item.destination.endsWith(path.join(".codex", "AGENTS.md")) && item.existed), "backup manifest does not record the previous AGENTS.md");
  assert(manifest.files.some((item) => item.destination.endsWith(path.join(".codex", "hooks.json")) && item.existed), "backup manifest does not record the previous hooks.json");

  const envArgs = { home };
  const refreshInput = `${JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: REPOSITORY_ROOT })}\n`;
  const refresh = run(path.join(home, ".codex", "hooks", "refresh-skill-registry.mjs"), [], { ...envArgs, input: refreshInput });
  assert(refresh.status === 0, `Skill registry refresh failed: ${refresh.stderr || refresh.stdout}`);
  const registry = JSON.parse(await readFile(path.join(home, ".codex", "skill-registry", "skills-index.json"), "utf8"));
  assert(registry.schemaVersion === "codex-skill-registry/2", "portable registry does not use the multi-root schema");
  assert(registry.roots.every((root) => root.source !== "project"), "global registry unexpectedly includes project Skill roots");
  assert(!registry.skills.some((skill) => skill.source === "project"), "global registry unexpectedly indexes project Skills");
  assert(registry.skills.filter((skill) => skill.source === "agents").length === expectedSkills.length, `expected ${expectedSkills.length} installed global Skills in the registry`);
  for (const name of expectedSkills) assert(registry.skills.some((skill) => skill.name === name), `registry is missing ${name}`);
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
  const installSkillInput = `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "请安装 skill", cwd: REPOSITORY_ROOT })}\n`;
  const installSkill = run(path.join(home, ".codex", "hooks", "skill-router.mjs"), [], { ...envArgs, input: installSkillInput });
  assert(installSkill.status === 0 && installSkill.stdout.includes("skill-installer"), `system skill-installer route did not match: ${installSkill.stderr || installSkill.stdout}`);
  const taskTreeInput = `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "帮我精简任务树的核心状态", cwd: REPOSITORY_ROOT })}\n`;
  const taskTree = run(path.join(home, ".codex", "hooks", "skill-router.mjs"), [], { ...envArgs, input: taskTreeInput });
  assert(taskTree.status === 0 && taskTree.stdout.includes("task-tree-core-state"), `task-tree core-state route did not match: ${taskTree.stderr || taskTree.stdout}`);

  const fixtureDirectory = path.join(root, "dispatcher-fixtures");
  await mkdir(fixtureDirectory, { recursive: true });
  const fixtureFiles = [];
  const fixtureNames = Array.from({ length: 20 }, (_, index) => `handler-${String(index + 1).padStart(2, "0")}`);
  for (const name of fixtureNames) {
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
  assert(parallel.status === 0 && fixtureNames.every((name) => parallel.stdout.includes(name)), "dispatcher did not merge all 20 fixture Hooks");
  const intervals = [...parallel.stdout.matchAll(/handler-\d{2}:(\d+):(\d+)/g)].map((match) => ({ start: Number(match[1]), end: Number(match[2]) }));
  assert(intervals.length === 20, `dispatcher did not expose 20 timing intervals: ${parallel.stdout}`);
  assert(Math.max(...intervals.map((item) => item.start)) < Math.min(...intervals.map((item) => item.end)), `dispatcher child intervals did not overlap: ${JSON.stringify(intervals)}`);
  const failedHandler = run(dispatcher, [], {
    ...envArgs,
    input: contextInput,
    extraEnv: {
      CODEX_HOOK_DISPATCH_TEST_MODE: "1",
      CODEX_HOOK_DISPATCH_HANDLERS_JSON: JSON.stringify([path.join(fixtureDirectory, "missing.mjs")])
    }
  });
  assert(failedHandler.status !== 0 && failedHandler.stderr.includes("exited with code"), "dispatcher test mode hid a child failure");

  const deployHome = path.join(root, "one-click-home");
  await seedHome(deployHome, "ONE_CLICK_SENTINEL");
  const deploy = runShell(DEPLOYER, ["--home", deployHome], { home: deployHome });
  assert(deploy.status === 0, `one-click deployment failed: ${deploy.stderr || deploy.stdout}`);
  assert(deploy.stdout.includes("available to every Codex workspace"), "one-click deployment did not report its global workspace scope");
  const deployedRegistry = JSON.parse(await readFile(path.join(deployHome, ".codex", "skill-registry", "skills-index.json"), "utf8"));
  assert(deployedRegistry.skills.filter((skill) => skill.source === "agents").length === expectedSkills.length, "one-click deployment did not register all global Skills");
  const deployedConfig = await readFile(path.join(deployHome, ".codex", "config.toml"), "utf8");
  assert(deployedConfig.includes("[mcp_servers.task_tree]") && deployedConfig.includes("enable_mcp_apps = true"), "one-click deployment did not register the global task_tree MCP app");
  const stagedSource = path.join(deployHome, ".codex", "tools", "ai-engineering-governance-template");
  const serviceRunner = path.join(stagedSource, "scripts", "run-codex-profile-service-mac.sh");
  assert(await readFile(serviceRunner, "utf8").then((text) => text.includes("deploy-codex-profile-mac.sh") && text.includes("CODEX_PROFILE_SOURCE")), "one-click deployment did not stage a stable global service runner");
  const serviceWorkflow = path.join(deployHome, "Library", "Services", "部署 Codex 全局配置.workflow");
  const workflow = await readFile(path.join(serviceWorkflow, "Contents", "document.wflow"), "utf8");
  assert(workflow.includes("workflowTypeIdentifier") && workflow.includes("com.apple.Automator.servicesMenu") && workflow.includes("serviceInputTypeIdentifier") && workflow.includes("run-codex-profile-service-mac.sh"), "one-click deployment did not install the Finder Quick Action");
  assert(!workflow.includes("Please select one governance repository folder") && !workflow.includes("$repo/scripts/deploy-codex-profile-mac.sh"), "Finder Quick Action still depends on the selected folder being the governance repository");
  const arbitraryWorkspace = path.join(root, "arbitrary-workspace");
  await mkdir(arbitraryWorkspace, { recursive: true });
  const arbitraryDeploy = runShell(serviceRunner, [arbitraryWorkspace], { home: deployHome });
  assert(arbitraryDeploy.status === 0, `Finder Quick Action runner failed for an arbitrary workspace: ${arbitraryDeploy.stderr || arbitraryDeploy.stdout}`);
  const serviceCheck = runShell(path.join(stagedSource, "scripts", "install-codex-profile-service-mac.sh"), ["--home", deployHome, "--check"], { home: deployHome });
  assert(serviceCheck.status === 0, `staged Finder Quick Action check failed: ${serviceCheck.stderr || serviceCheck.stdout}`);

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
  const oldConfig = await readFile(path.join(failureHome, ".codex", "config.toml"));
  const failed = run(INSTALLER, ["--home", failureHome], { home: failureHome, extraEnv: { CODEX_PROFILE_TEST_FAIL_STAGE: "post-write" } });
  assert(failed.status !== 0, "injected installation failure unexpectedly succeeded");
  assert((await readFile(path.join(failureHome, ".codex", "AGENTS.md"))).equals(oldAgents), "rollback did not restore AGENTS.md");
  assert((await readFile(path.join(failureHome, ".codex", "hooks.json"))).equals(oldHooks), "rollback did not restore hooks.json");
  assert((await readFile(path.join(failureHome, ".codex", "config.toml"))).equals(oldConfig), "rollback did not restore config.toml");
  assert(!await readFile(path.join(failureHome, ".codex", "prompts", "global-every-turn.en.md")).then(() => true, () => false), "rollback left a newly installed prompt behind");

  console.log("PASS: macOS one-click deployment, profile install, global task_tree MCP, all 22 global Skills, global-only registry, system and task-tree routing, merge, manifest backup, credential isolation, 63-rule validation, 20-way batching, failure visibility, idempotent update, check mode, and rollback.");
} finally {
  await rm(root, { recursive: true, force: true });
}
