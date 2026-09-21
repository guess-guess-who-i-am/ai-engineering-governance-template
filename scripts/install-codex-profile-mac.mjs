#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.dirname(SCRIPT_DIR);
const PROFILE_ROOT = path.join(REPOSITORY_ROOT, "codex-profile");
const SKILLS_ROOT = path.join(PROFILE_ROOT, "global-skills");
const BLOCK_BEGIN = "<!-- ai-engineering-governance-template:begin -->";
const BLOCK_END = "<!-- ai-engineering-governance-template:end -->";
const GLOBAL_SKILLS = [
  "manage-global-methodology",
  "method-research-evidence",
  "method-engineering-execution",
  "method-evaluation-gates",
  "method-github-delivery",
  "method-task-tree",
  "build-designed-interface",
  "clarify-before-build",
  "establish-test-strategy",
  "evolve-contracts",
  "fix-regression-with-tdd",
  "model-project-domain",
  "review-governance-framework",
  "review-project-diff",
  "start-new-project",
  "systematic-debugging",
  "verify-before-completion",
  "write-pr-description",
  "task-tree-chain-run",
  "task-tree-core-state",
  "task-tree-grill",
  "task-tree-subtree-run"
];
const GLOBAL_CONFIG = {
  root: { web_search: 'web_search = "live"' },
  features: { hooks: "hooks = true", multi_agent: "multi_agent = true" },
  agents: { enabled: "enabled = true", max_concurrent_threads_per_session: "max_concurrent_threads_per_session = 20" }
};

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

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function exists(file) {
  try { await access(file); return true; }
  catch { return false; }
}

async function filesUnder(root) {
  const output = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) output.push(target);
    }
  }
  await visit(root);
  return output.sort();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function mergeManagedBlock(current, managed) {
  const block = `${BLOCK_BEGIN}\n${managed.trim()}\n${BLOCK_END}`;
  const start = current.indexOf(BLOCK_BEGIN);
  const end = current.indexOf(BLOCK_END);
  if ((start >= 0) !== (end >= 0) || (start >= 0 && end < start)) {
    throw new Error("Existing AGENTS.md has an incomplete managed block; repair or remove the marker before installing.");
  }
  if (start >= 0) {
    return `${current.slice(0, start).trimEnd()}\n\n${block}${current.slice(end + BLOCK_END.length)}`.trim() + "\n";
  }
  return current.trim() ? `${current.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

function mergeConfigSection(lines, section, entries) {
  const header = section ? `[${section}]` : null;
  let start = section ? lines.findIndex((line) => line.trim() === header) : 0;
  if (section && start < 0) {
    if (lines.length && lines.at(-1).trim()) lines.push("");
    lines.push(header);
    start = lines.length - 1;
  }
  let end = lines.length;
  if (section) {
    const next = lines.slice(start + 1).findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
    if (next >= 0) end = start + 1 + next;
  } else {
    const firstSection = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
    if (firstSection >= 0) end = firstSection;
  }
  for (const [key, value] of Object.entries(entries)) {
    const index = lines.slice(start, end).findIndex((line) => new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*=`).test(line));
    if (index >= 0) lines[start + index] = value;
    else lines.splice(end, 0, value), end += 1;
  }
}

function mergeGlobalConfig(current) {
  const lines = String(current || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  mergeConfigSection(lines, null, GLOBAL_CONFIG.root);
  mergeConfigSection(lines, "features", GLOBAL_CONFIG.features);
  mergeConfigSection(lines, "agents", GLOBAL_CONFIG.agents);
  return `${lines.join("\n")}\n`;
}

function hooksDocument(codexHome) {
  const command = (name) => `${shellQuote(process.execPath)} ${shellQuote(path.join(codexHome, "hooks", name))}`;
  return {
    description: "One stable dispatcher per event keeps Hook trust indices fixed while internally batching reminders, Skill routing, capability routing, and refresh work.",
    hooks: {
      UserPromptSubmit: [{ hooks: [
        { type: "command", command: command("hook-dispatch.mjs"), timeout: 20, statusMessage: "Loading reminders and routing in parallel", additionalContextLimit: 14000 }
      ] }],
      SessionStart: [{ matcher: "^(startup|resume|clear|compact)$", hooks: [
        { type: "command", command: command("hook-dispatch.mjs"), timeout: 70, statusMessage: "Restoring reminders and refreshing indexes in parallel", additionalContextLimit: 10000 }
      ] }]
    }
  };
}

async function buildOperations(home) {
  const codexHome = path.join(home, ".codex");
  const agentsHome = path.join(home, ".agents");
  const operations = new Map();
  const addTree = async (sourceRoot, destinationRoot, filter = () => true) => {
    for (const source of await filesUnder(sourceRoot)) {
      if (!filter(source)) continue;
      const destination = path.join(destinationRoot, path.relative(sourceRoot, source));
      operations.set(destination, { destination, content: await readFile(source), mode: 0o600, source });
    }
  };

  await addTree(path.join(PROFILE_ROOT, ".codex", "prompts"), path.join(codexHome, "prompts"));
  await addTree(
    path.join(PROFILE_ROOT, ".codex", "prompt-publisher"),
    path.join(codexHome, "prompt-publisher"),
    (source) => !source.endsWith("methodology-targets.json")
  );
  await addTree(path.join(PROFILE_ROOT, "mac", "hooks"), path.join(codexHome, "hooks"));
  const dispatcherSource = path.join(PROFILE_ROOT, ".codex", "hooks", "hook-dispatch.mjs");
  operations.set(path.join(codexHome, "hooks", "hook-dispatch.mjs"), {
    destination: path.join(codexHome, "hooks", "hook-dispatch.mjs"),
    content: await readFile(dispatcherSource),
    mode: 0o700,
    source: dispatcherSource
  });
  const routerSource = path.join(PROFILE_ROOT, ".codex", "hooks", "skill-router.mjs");
  operations.set(path.join(codexHome, "hooks", "skill-router.mjs"), {
    destination: path.join(codexHome, "hooks", "skill-router.mjs"),
    content: await readFile(routerSource),
    mode: 0o700,
    source: routerSource
  });
  for (const name of GLOBAL_SKILLS) {
    await addTree(path.join(SKILLS_ROOT, name), path.join(agentsHome, "skills", name));
  }

  const routingSource = path.join(PROFILE_ROOT, ".codex", "skill-registry", "routing-rules.json");
  operations.set(path.join(codexHome, "skill-registry", "routing-rules.json"), {
    destination: path.join(codexHome, "skill-registry", "routing-rules.json"),
    content: await readFile(routingSource),
    mode: 0o600,
    source: routingSource
  });

  const sourceConfig = JSON.parse(await readFile(path.join(PROFILE_ROOT, ".codex", "prompt-publisher", "methodology-targets.json"), "utf8"));
  sourceConfig.validatorFile = "../hooks/validate-methodology-routing.mjs";
  sourceConfig.refreshRegistryFile = "../hooks/refresh-skill-registry.mjs";
  for (const route of sourceConfig.routes || []) {
    if (route.skillFile) route.skillFile = `../../.agents/skills/${route.id}/SKILL.md`;
  }
  const methodologyDestination = path.join(codexHome, "prompt-publisher", "methodology-targets.json");
  operations.set(methodologyDestination, {
    destination: methodologyDestination,
    content: Buffer.from(`${JSON.stringify(sourceConfig, null, 2)}\n`),
    mode: 0o600,
    source: "generated:methodology-targets"
  });

  const agentsDestination = path.join(codexHome, "AGENTS.md");
  const currentAgents = await exists(agentsDestination) ? await readFile(agentsDestination, "utf8") : "";
  const managedAgents = await readFile(path.join(PROFILE_ROOT, ".codex", "AGENTS.md"), "utf8");
  operations.set(agentsDestination, {
    destination: agentsDestination,
    content: Buffer.from(mergeManagedBlock(currentAgents, managedAgents)),
    mode: 0o600,
    source: "generated:merged-agents"
  });

  const hooksDestination = path.join(codexHome, "hooks.json");
  operations.set(hooksDestination, {
    destination: hooksDestination,
    content: Buffer.from(`${JSON.stringify(hooksDocument(codexHome), null, 2)}\n`),
    mode: 0o600,
    source: "generated:hooks"
  });
  const configDestination = path.join(codexHome, "config.toml");
  const currentConfig = await exists(configDestination) ? await readFile(configDestination, "utf8") : "";
  operations.set(configDestination, {
    destination: configDestination,
    content: Buffer.from(mergeGlobalConfig(currentConfig)),
    mode: 0o600,
    source: "generated:global-config"
  });
  return { codexHome, operations: [...operations.values()].sort((a, b) => a.destination.localeCompare(b.destination)) };
}

async function changedOperations(operations) {
  const changed = [];
  for (const operation of operations) {
    let current = null;
    try { current = await readFile(operation.destination); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!current?.equals(operation.content)) changed.push({ ...operation, original: current });
  }
  return changed;
}

function backupId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function atomicWrite(file, content, mode) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.portable-profile-${process.pid}.tmp`;
  await writeFile(temporary, content, { mode });
  await rename(temporary, file);
  await chmod(file, mode);
}

async function applyTransaction(codexHome, changes) {
  const backupDirectory = path.join(codexHome, "backups", "portable-profile", backupId());
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const manifest = {
    schemaVersion: "codex-portable-profile-backup/1",
    createdAt: new Date().toISOString(),
    repository: REPOSITORY_ROOT,
    files: []
  };
  for (const change of changes) {
    const relative = path.relative(path.dirname(codexHome), change.destination);
    const backup = change.original === null ? null : path.join(backupDirectory, relative);
    if (backup) await atomicWrite(backup, change.original, 0o600);
    manifest.files.push({
      destination: change.destination,
      existed: change.original !== null,
      beforeSha256: change.original === null ? null : sha256(change.original),
      afterSha256: sha256(change.content),
      backup
    });
  }
  await atomicWrite(path.join(backupDirectory, "manifest.json"), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), 0o600);
  try {
    for (const change of changes) await atomicWrite(change.destination, change.content, change.mode);
    if (process.env.CODEX_PROFILE_TEST_FAIL_STAGE === "post-write") throw new Error("Injected post-write failure for rollback verification");
  } catch (error) {
    for (const change of [...changes].reverse()) {
      if (change.original === null) await rm(change.destination, { force: true });
      else await atomicWrite(change.destination, change.original, change.mode);
    }
    throw error;
  }
  return { backupDirectory, changes };
}

function run(command, args, { env, input = "", timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(command)} timed out`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: Number(code), stdout, stderr }); });
    child.stdin.end(input);
  });
}

async function verifyInstallation(home, codexHome, operations) {
  const drift = await changedOperations(operations);
  if (drift.length) throw new Error(`Installed profile differs in ${drift.length} managed file(s): ${drift.slice(0, 5).map((item) => item.destination).join(", ")}`);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome };
  const publisher = await run(process.execPath, [
    path.join(codexHome, "prompt-publisher", "publish-methodology.mjs"),
    "--config",
    path.join(codexHome, "prompt-publisher", "methodology-targets.json"),
    "--check",
    "--json"
  ], { env });
  if (publisher.code !== 0) throw new Error(`Cross-platform methodology check failed: ${`${publisher.stderr}\n${publisher.stdout}`.trim()}`);
  let publication;
  try { publication = JSON.parse(publisher.stdout); }
  catch { throw new Error(`Methodology publisher returned invalid JSON: ${publisher.stdout.trim()}`); }
  const hookInput = `${JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello", cwd: REPOSITORY_ROOT })}\n`;
  const context = await run(process.execPath, [path.join(codexHome, "hooks", "hook-dispatch.mjs")], { env, input: hookInput });
  if (context.code !== 0 || !context.stdout.includes("AUTOMATIC_TOOL_BATCHING_CONTRACT_V3")) throw new Error("Hook dispatcher did not emit the automatic batching contract");
  return { validation: publication.validation, trust: await inspectHookTrust(codexHome) };
}

async function inspectHookTrust(codexHome) {
  const configFile = path.join(codexHome, "config.toml");
  if (!await exists(configFile)) return { status: "action-required", reason: "config.toml is absent, so Hook trust cannot be confirmed" };
  const config = await readFile(configFile, "utf8");
  const hookFile = path.join(codexHome, "hooks.json");
  const identifiers = ["session_start:0:0", "user_prompt_submit:0:0"];
  const present = identifiers.filter((id) => config.includes(`${hookFile}:${id}`) && config.slice(config.indexOf(`${hookFile}:${id}`)).slice(0, 300).includes("trusted_hash"));
  return present.length === identifiers.length
    ? { status: "recorded", reason: "both stable dispatcher entries have persisted trust records; Codex still decides whether hashes remain current" }
    : { status: "action-required", reason: "start Codex interactively and approve each Hook when prompted" };
}

async function install(options) {
  const { codexHome, operations } = await buildOperations(options.home);
  if (options.check) {
    const verification = await verifyInstallation(options.home, codexHome, operations);
    return { status: "current", home: options.home, codexHome, changedFiles: 0, ...verification };
  }
  const changes = await changedOperations(operations);
  let transaction = null;
  try {
    if (changes.length) transaction = await applyTransaction(codexHome, changes);
    const verification = await verifyInstallation(options.home, codexHome, operations);
    return {
      status: changes.length ? "installed" : "already-current",
      home: options.home,
      codexHome,
      changedFiles: changes.length,
      backupDirectory: transaction?.backupDirectory || null,
      ...verification
    };
  } catch (error) {
    if (transaction) {
      for (const change of [...transaction.changes].reverse()) {
        if (change.original === null) await rm(change.destination, { force: true });
        else await atomicWrite(change.destination, change.original, change.mode);
      }
    }
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await install(options);
  if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    console.log(`Portable Codex profile: ${result.status}`);
    console.log(`Managed files changed: ${result.changedFiles}`);
    if (result.backupDirectory) console.log(`Recovery backup: ${result.backupDirectory}`);
    console.log(result.validation);
    if (result.trust.status === "action-required") console.log(`Hook trust: ACTION REQUIRED - ${result.trust.reason}`);
    else console.log(`Hook trust: ${result.trust.reason}`);
    console.log("Credentials were not read or modified. GitHub and Codex login remain machine-local.");
  }
}

main().catch((error) => {
  console.error(`Portable profile installation failed: ${error.message}`);
  process.exitCode = 1;
});
