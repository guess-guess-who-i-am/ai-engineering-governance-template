#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER = path.join(SCRIPT_DIR, "install-codex-profile-mac.mjs");
const DEPLOYER = path.join(SCRIPT_DIR, "deploy-codex-profile-mac.sh");
const REPOSITORY_ROOT = path.dirname(SCRIPT_DIR);
const GRAPH_PYTHON = process.env.CODEX_GRAPH_TOOL_PYTHON || "/Users/pku1727/.codex/tools/graph-tool-call-venv/bin/python";

function hash(data) { return createHash("sha256").update(data).digest("hex"); }

function run(file, args, { home, input = "", extraEnv = {} } = {}) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    input,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), HF_HOME: process.env.HF_HOME || path.join(os.tmpdir(), "codex-profile-hf-cache"), TRANSFORMERS_CACHE: process.env.TRANSFORMERS_CACHE || path.join(os.tmpdir(), "codex-profile-hf-cache"), ...extraEnv }
  });
  return result;
}

function runShell(file, args, { home, input = "", extraEnv = {} } = {}) {
  return spawnSync("/bin/sh", [file, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    input,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), HF_HOME: process.env.HF_HOME || path.join(os.tmpdir(), "codex-profile-hf-cache"), TRANSFORMERS_CACHE: process.env.TRANSFORMERS_CACHE || path.join(os.tmpdir(), "codex-profile-hf-cache"), ...extraEnv }
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
const skillFixture = path.join(root, "external skills with spaces");
const skillCatalog = path.join(skillFixture, "_catalog_cn.json");
const fixtureSkillDir = path.join(skillFixture, "acme-astro-islands");
await mkdir(fixtureSkillDir, { recursive: true });
await writeFile(path.join(fixtureSkillDir, "SKILL.md"), "---\nname: astro-islands\ndescription: Build Astro islands architecture and hydration patterns.\n---\nfixture\n");
await writeFile(skillCatalog, JSON.stringify({ skills: [
  { name: "astro-islands", dir: "acme-astro-islands", description: "Build Astro islands architecture", problem_cn: "Astro islands", when_cn: "Astro rendering", c1: "islands", c2: "hydration", key: "astro-islands" },
  { name: "missing-skill", dir: "missing-skill", description: "missing", problem_cn: "missing", when_cn: "missing", key: "missing-skill" }
] }));
try {
  const home = path.join(root, "home with spaces");
  await seedHome(home, "KEEP_CUSTOM_CONFIGURATION");
  await mkdir(path.join(home, ".codex", "tools", "graph-tool-call-venv", "bin"), { recursive: true });
  await mkdir(path.join(home, ".codex", "skill-registry"), { recursive: true });
  await cp(path.join(REPOSITORY_ROOT, "codex-profile", "mac", "hooks", "graph_skill_index.py"), path.join(home, ".codex", "hooks", "graph_skill_index.py"));
  await writeFile(path.join(home, ".codex", "skill-registry", "external-library-config.json"), JSON.stringify({ root: skillFixture, catalog: skillCatalog }));
  const graphPython = path.join(home, ".codex", "tools", "graph-tool-call-venv", "bin", "python");
  const authFile = path.join(home, ".codex", "auth.json");
  const configFile = path.join(home, ".codex", "config.toml");
  const authBefore = hash(await readFile(authFile));

  const install = run(INSTALLER, ["--home", home, "--json"], { home, extraEnv: { CODEX_EXTERNAL_SKILL_ROOT: skillFixture, CODEX_EXTERNAL_SKILL_CATALOG: skillCatalog, CODEX_GRAPH_TOOL_PYTHON: GRAPH_PYTHON } });
  assert(install.status === 0, `clean install failed: ${install.stderr || install.stdout}`);
  const result = JSON.parse(install.stdout);
  assert(result.status === "installed" && result.changedFiles > 0, "installer did not report a real installation");
  assert((await readFile(path.join(home, ".codex", "skill-registry", "external-library-config.json"), "utf8")).includes(skillFixture), "installer did not configure the external global Skill library");
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
  const refresh = run(path.join(home, ".codex", "hooks", "refresh-skill-registry.mjs"), [], { ...envArgs, extraEnv: { CODEX_GRAPH_TOOL_PYTHON: GRAPH_PYTHON }, input: refreshInput });
  assert(refresh.status === 0, `Skill registry refresh failed: ${refresh.stderr || refresh.stdout}`);
  const registry = JSON.parse(await readFile(path.join(home, ".codex", "skill-registry", "skills-index.json"), "utf8"));
  assert(registry.schemaVersion === "codex-skill-registry/2", "portable registry does not use the multi-root schema");
  assert(registry.externalSkillCount === 1 && registry.externalMissingSkillCount === 1, `external Skill graph counts are wrong: ${registry.externalSkillCount}/${registry.externalMissingSkillCount}`);
  const externalGraph = path.join(home, ".codex", "skill-registry", "skills.graph.json");
  assert((await stat(externalGraph)).size > 0, "GraphToolCall graph index is empty");
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
  assert(context.status === 0 && contextText.startsWith("[ADAPTIVE_TOOL_SCHEDULING_CONTRACT_V4]") && contextText.includes("Start ordinary read-only waves at 2-4") && contextText.includes("halve it after failures"), "adaptive scheduling contract is absent, not first, or weakened");
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
  const externalRoute = run(path.join(home, ".codex", "hooks", "skill-router.mjs"), [], { ...envArgs, extraEnv: { CODEX_GRAPH_TOOL_PYTHON: GRAPH_PYTHON }, input: `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "Help implement Astro islands hydration patterns", cwd: REPOSITORY_ROOT })}\n` });
  assert(externalRoute.status === 0 && externalRoute.stdout.includes("astro-islands") && externalRoute.stdout.includes("external skills with spaces/acme-astro-islands/SKILL.md"), `GraphToolCall Skill route failed: ${externalRoute.stderr || externalRoute.stdout}`);

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
  const deploySource = path.join(root, "deployment-source");
  await mkdir(path.join(deploySource, "scripts"), { recursive: true });
  await mkdir(path.join(deploySource, "codex-profile"), { recursive: true });
  await writeFile(path.join(deploySource, "scripts", "deploy-codex-profile-mac.sh"), "#!/bin/sh\nexit 0\n");
  const deploy = runShell(DEPLOYER, ["--home", deployHome], { home: deployHome, extraEnv: { CODEX_PROFILE_SKILL_SOURCE: skillFixture, CODEX_PROFILE_SKILL_CATALOG: skillCatalog } });
  assert(deploy.status === 0, `one-click deployment failed: ${deploy.stderr || deploy.stdout}`);
  assert(deploy.stdout.includes("available to every Codex workspace"), "one-click deployment did not report its global workspace scope");
  const deployedRefresh = run(path.join(deployHome, ".codex", "hooks", "refresh-skill-registry.mjs"), [], { home: deployHome, extraEnv: { CODEX_GRAPH_TOOL_PYTHON: GRAPH_PYTHON }, input: refreshInput });
  assert(deployedRefresh.status === 0, `one-click SessionStart refresh failed: ${deployedRefresh.stderr || deployedRefresh.stdout}`);
  const deployedRegistry = JSON.parse(await readFile(path.join(deployHome, ".codex", "skill-registry", "skills-index.json"), "utf8"));
  assert(deployedRegistry.skills.filter((skill) => skill.source === "agents").length === expectedSkills.length, "one-click deployment did not register all global Skills");
  const deployedConfig = await readFile(path.join(deployHome, ".codex", "config.toml"), "utf8");
  assert(deployedConfig.includes("[mcp_servers.task_tree]") && deployedConfig.includes("enable_mcp_apps = true"), "one-click deployment did not register the global task_tree MCP app");
  const stagedSource = path.join(deployHome, ".codex", "tools", "ai-engineering-governance-template");
  const serviceRunner = path.join(stagedSource, "scripts", "run-codex-profile-service-mac.sh");
  assert(await readFile(serviceRunner, "utf8").then((text) => text.includes("deploy-codex-profile-mac.sh") && text.includes("CODEX_PROFILE_SOURCE") && text.includes("CODEX_PROFILE_SKILL_SOURCE") && text.includes("CODEX_PROFILE_SKILL_CATALOG")), "one-click deployment did not stage a stable global service runner");
  const serviceWorkflow = path.join(deployHome, "Library", "Services", "部署 Codex 全局配置.workflow");
  const workflow = await readFile(path.join(serviceWorkflow, "Contents", "document.wflow"), "utf8");
  assert(workflow.includes("workflowTypeIdentifier") && workflow.includes("com.apple.Automator.servicesMenu") && workflow.includes("serviceInputTypeIdentifier") && workflow.includes("run-codex-profile-service-mac.sh"), "one-click deployment did not install the Finder Quick Action");
  assert(!workflow.includes("Please select one governance repository folder") && !workflow.includes("$repo/scripts/deploy-codex-profile-mac.sh"), "Finder Quick Action still depends on the selected folder being the governance repository");
  const arbitraryWorkspace = path.join(root, "arbitrary-workspace");
  await mkdir(arbitraryWorkspace, { recursive: true });
  const arbitraryDeploy = runShell(serviceRunner, [arbitraryWorkspace], { home: deployHome });
  assert(arbitraryDeploy.status === 0, `Finder Quick Action runner failed for an arbitrary workspace: ${arbitraryDeploy.stderr || arbitraryDeploy.stdout}`);
  const serviceCheck = runShell(path.join(stagedSource, "scripts", "install-codex-profile-service-mac.sh"), ["--home", deployHome, "--check"], { home: deployHome, extraEnv: { CODEX_PROFILE_SKILL_SOURCE: skillFixture, CODEX_PROFILE_SKILL_CATALOG: skillCatalog } });
  assert(serviceCheck.status === 0, `staged Finder Quick Action check failed: ${serviceCheck.stderr || serviceCheck.stdout}`);

  const syncHome = path.join(root, "quick-action-sync-home");
  await seedHome(syncHome, "QUICK_ACTION_SYNC_SENTINEL");
  const syncLibrarySource = path.join(root, "quick-action-skill-library");
  await mkdir(path.join(syncLibrarySource, "acme-astro-islands"), { recursive: true });
  await writeFile(path.join(syncLibrarySource, "acme-astro-islands", "SKILL.md"), "---\nname: astro-islands\ndescription: Build Astro islands.\n---\nfixture\n");
  await writeFile(path.join(syncLibrarySource, "_catalog_cn.json"), "{\"skills\":[]}");
  const syncSource = path.join(root, "quick-action-source");
  await mkdir(path.join(syncSource, "scripts"), { recursive: true });
  await mkdir(path.join(syncSource, "codex-profile"), { recursive: true });
  await mkdir(path.join(syncSource, "codex-profile", "mac", "quick-actions", "部署 Codex 全局配置.workflow", "Contents"), { recursive: true });
  await writeFile(path.join(syncSource, "codex-profile", "mac", "quick-actions", "部署 Codex 全局配置.workflow", "Contents", "document.wflow"), "fixture workflow\n");
  await writeFile(path.join(syncSource, "scripts", "deploy-codex-profile-mac.sh"), "#!/bin/sh\nexit 0\n");
  const syncRunner = path.join(syncSource, "scripts", "run-codex-profile-service-mac.sh");
  await writeFile(syncRunner, await readFile(path.join(SCRIPT_DIR, "run-codex-profile-service-mac.sh"), "utf8"));
  await writeFile(path.join(syncSource, "scripts", "install-codex-profile-mac.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(path.join(syncSource, "scripts", "install-codex-profile-mac.mjs"), "process.exit(0);\n");
  await writeFile(path.join(syncSource, "scripts", "test-codex-profile-mac.mjs"), "process.exit(0);\n");
  await writeFile(path.join(syncSource, "scripts", "run-codex-profile-service-mac.sh"), await readFile(syncRunner));
  await writeFile(path.join(syncSource, "scripts", "install-codex-profile-service-mac.sh"), await readFile(path.join(SCRIPT_DIR, "install-codex-profile-service-mac.sh")));
  await writeFile(path.join(syncSource, "scripts", "install-task-tree-mcp-mac.mjs"), "process.exit(0);\n");
  await writeFile(path.join(syncSource, "scripts", "parallel-run.mjs"), await readFile(path.join(SCRIPT_DIR, "parallel-run.mjs"), "utf8"));
  const syncTools = path.join(syncHome, ".codex", "tools");
  const stagedProfile = path.join(syncTools, "ai-engineering-governance-template");
  await mkdir(path.join(stagedProfile, "scripts"), { recursive: true });
  await mkdir(path.join(stagedProfile, "codex-profile"), { recursive: true });
  await mkdir(path.join(stagedProfile, "codex-profile", "mac", "quick-actions", "部署 Codex 全局配置.workflow", "Contents"), { recursive: true });
  await writeFile(path.join(stagedProfile, "codex-profile", "mac", "quick-actions", "部署 Codex 全局配置.workflow", "Contents", "document.wflow"), "fixture workflow\n");
  await writeFile(path.join(stagedProfile, "scripts", "run-codex-profile-service-mac.sh"), await readFile(syncRunner));
  await writeFile(path.join(stagedProfile, "scripts", "deploy-codex-profile-mac.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(path.join(stagedProfile, "scripts", "install-codex-profile-mac.sh"), "#!/bin/sh\nexit 0\n");
  await writeFile(path.join(stagedProfile, "scripts", "install-codex-profile-mac.mjs"), "process.exit(0);\n");
  await writeFile(path.join(stagedProfile, "scripts", "test-codex-profile-mac.mjs"), "process.exit(0);\n");
  await writeFile(path.join(stagedProfile, "scripts", "install-task-tree-mcp-mac.mjs"), "process.exit(0);\n");
  await writeFile(path.join(stagedProfile, "scripts", "install-codex-profile-service-mac.sh"), await readFile(path.join(SCRIPT_DIR, "install-codex-profile-service-mac.sh")));
  await writeFile(path.join(stagedProfile, "scripts", "parallel-run.mjs"), "stale runner\n");
  const liveLibrary = path.join(syncTools, "skills");
  await mkdir(path.join(liveLibrary, "obsolete-managed-skill"), { recursive: true });
  await mkdir(path.join(liveLibrary, "astro-islands"), { recursive: true });
  await writeFile(path.join(liveLibrary, "keep-user-note.txt"), "user-owned\n");
  await writeFile(path.join(liveLibrary, "obsolete-managed-skill", "SKILL.md"), "obsolete\n");
  await writeFile(path.join(liveLibrary, "astro-islands", "SKILL.md"), "old managed version\n");
  const syncManifestPath = path.join(syncHome, ".codex", "skill-registry", "external-library-manifest.json");
  await mkdir(path.dirname(syncManifestPath), { recursive: true });
  await writeFile(syncManifestPath, JSON.stringify({ destination: liveLibrary, files: [
    { relativePath: "obsolete-managed-skill/SKILL.md", sha256: hash("obsolete\n") },
    { relativePath: "astro-islands/SKILL.md", sha256: hash("old managed version\n") }
  ] }));
  const staleCatalog = path.join(root, "stale-catalog.json");
  await writeFile(staleCatalog, "{\"skills\":[]}");
  const syncInstall = runShell(path.join(syncSource, "scripts", "install-codex-profile-service-mac.sh"), ["--home", syncHome], { home: syncHome, extraEnv: { CODEX_PROFILE_SKILL_SOURCE: syncLibrarySource, CODEX_PROFILE_SKILL_CATALOG: skillCatalog } });
  assert(syncInstall.status === 0, `safe Finder Skill sync failed: ${syncInstall.stderr || syncInstall.stdout}`);
  assert(await readFile(path.join(liveLibrary, "keep-user-note.txt"), "utf8").then((value) => value.includes("user-owned")), "Finder Skill sync deleted user-owned files");
  assert(await readFile(path.join(liveLibrary, "acme-astro-islands", "SKILL.md"), "utf8").then((value) => value.includes("Build Astro islands.")), "Finder Skill sync failed to update managed files");
  assert(await readFile(path.join(liveLibrary, "obsolete-managed-skill", "SKILL.md"), "utf8").then((value) => value.includes("obsolete")), "Finder Skill sync removed a stale unmanaged file");
  assert(await readFile(path.join(liveLibrary, "_catalog_cn.json"), "utf8").then((value) => value.includes("skills")), "Finder Skill sync did not preserve the catalog");
  assert(await readFile(path.join(stagedProfile, "scripts", "parallel-run.mjs"), "utf8").then((value) => value.includes("Execute a dependency DAG in adaptive waves")), "Finder source sync did not update the adaptive scheduler");

  const reinstall = run(INSTALLER, ["--home", home, "--json"], { home, extraEnv: { CODEX_EXTERNAL_SKILL_ROOT: skillFixture, CODEX_EXTERNAL_SKILL_CATALOG: skillCatalog, CODEX_GRAPH_TOOL_PYTHON: GRAPH_PYTHON } });
  assert(reinstall.status === 0, `repeat install failed: ${reinstall.stderr || reinstall.stdout}`);
  const agentsAfter = await readFile(path.join(home, ".codex", "AGENTS.md"), "utf8");
  assert((agentsAfter.match(/ai-engineering-governance-template:begin/g) || []).length === 1, "repeat install duplicated the managed AGENTS.md block");
  const check = run(INSTALLER, ["--home", home, "--check", "--json"], { home, extraEnv: { CODEX_EXTERNAL_SKILL_ROOT: skillFixture, CODEX_EXTERNAL_SKILL_CATALOG: skillCatalog, CODEX_GRAPH_TOOL_PYTHON: GRAPH_PYTHON } });
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

  const fullFixture = process.env.CODEX_PROFILE_FULL_SKILL_FIXTURE;
  if (fullFixture) {
    const fullHome = path.join(root, "full-library-home");
    await seedHome(fullHome, "FULL_LIBRARY_SENTINEL");
  const fullInstall = run(INSTALLER, ["--home", fullHome, "--json"], { home: fullHome, extraEnv: { CODEX_EXTERNAL_SKILL_ROOT: fullFixture, CODEX_EXTERNAL_SKILL_CATALOG: path.join(fullFixture, "_catalog_cn.json"), CODEX_GRAPH_TOOL_PYTHON: GRAPH_PYTHON } });
    assert(fullInstall.status === 0, `full catalog profile setup failed: ${fullInstall.stderr || fullInstall.stdout}`);
  const fullRefresh = run(path.join(fullHome, ".codex", "hooks", "refresh-skill-registry.mjs"), [], { home: fullHome, extraEnv: { CODEX_GRAPH_TOOL_PYTHON: GRAPH_PYTHON }, input: refreshInput });
    assert(fullRefresh.status === 0, `full catalog indexing failed: ${fullRefresh.stderr || fullRefresh.stdout}`);
    const fullManifest = JSON.parse(await readFile(path.join(fullHome, ".codex", "skill-registry", "external-skills-manifest.json"), "utf8"));
    const fullIndex = await readFile(path.join(fullHome, ".codex", "skill-registry", "skills.graph.json"));
    assert(fullManifest.catalogSkillCount === 15472 && fullManifest.skillCount > 15000, `full catalog was not indexed in its entirety: ${fullManifest.catalogSkillCount}/${fullManifest.skillCount}`);
  const semanticRoute = run(path.join(fullHome, ".codex", "hooks", "skill-router.mjs"), [], { home: fullHome, extraEnv: { CODEX_GRAPH_TOOL_PYTHON: GRAPH_PYTHON }, input: `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "I need to resolve a git merge conflict safely", cwd: REPOSITORY_ROOT })}\n` });
    assert(semanticRoute.status === 0 && semanticRoute.stdout.includes("resolving-merge-conflicts"), `real external Skill was not routed: ${semanticRoute.stderr || semanticRoute.stdout}`);
    console.log(`PASS: full catalog fixture indexed ${fullManifest.skillCount}/${fullManifest.catalogSkillCount} Skills; total index bytes=${Buffer.byteLength(fullIndex)}; example route=resolving-merge-conflicts`);
  }

  console.log("PASS: macOS one-click deployment, profile install, GraphToolCall Skill graph index and routing, global task_tree MCP, 22 owned Skills, global-only registry, system and task-tree routing, merge, manifest backup, credential isolation, 63-rule validation, adaptive scheduling contract, dispatcher overlap, failure visibility, idempotent update, check mode, and rollback.");
} finally {
  await rm(root, { recursive: true, force: true });
}
