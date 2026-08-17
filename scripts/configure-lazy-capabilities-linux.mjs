#!/usr/bin/env node
import { access, copyFile, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CORE_AGENT_SKILLS = new Set([
  "manage-global-methodology",
  "method-engineering-execution",
  "method-evaluation-gates",
  "method-github-delivery",
  "method-research-evidence",
  "method-task-tree",
  "find-skills",
  "write-a-skill"
]);
const PLUGINS = [
  "documents@openai-primary-runtime",
  "pdf@openai-primary-runtime",
  "spreadsheets@openai-primary-runtime",
  "presentations@openai-primary-runtime",
  "template-creator@openai-primary-runtime"
];
const PROFILE_NAMES = ["task-tree", "full-tools", "documents", "pdf", "spreadsheets", "presentations", "template-creator"];

function parseArgs(argv) {
  const options = { home: os.homedir(), restore: "", taskTreeEntry: path.join(path.dirname(SCRIPT_DIR), "llm-task-tree", "mcp-server.mjs") };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--home") options.home = argv[++index];
    else if (argument === "--restore") options.restore = argv[++index];
    else if (argument === "--task-tree-entry") options.taskTreeEntry = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.home = path.resolve(options.home);
  options.taskTreeEntry = path.resolve(options.taskTreeEntry);
  if (options.restore) options.restore = path.resolve(options.restore);
  return options;
}

async function exists(target) {
  try { await access(target); return true; }
  catch { return false; }
}

async function atomicWrite(target, text) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, target);
}

function setFeature(text, name, enabled) {
  const section = text.match(/^\[features\][ \t]*\n[\s\S]*?(?=^\[|(?![\s\S]))/m);
  if (!section) throw new Error("Codex config has no [features] section");
  const value = String(enabled);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = new RegExp(`^${escaped}\\s*=.*$`, "m");
  const replacement = line.test(section[0])
    ? section[0].replace(line, `${name} = ${value}`)
    : section[0].replace(/^\[features\][ \t]*\n/, `[features]\n${name} = ${value}\n`);
  return text.slice(0, section.index) + replacement + text.slice(section.index + section[0].length);
}

function setPluginEnabled(text, plugin, enabled) {
  const escaped = plugin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = new RegExp(`^\\[plugins\\."${escaped}"\\][ \\t]*\\n[\\s\\S]*?(?=^\\[|(?![\\s\\S]))`, "m");
  const match = text.match(section);
  if (!match) return text;
  const enabledLine = /^enabled\s*=.*$/m;
  const replacement = enabledLine.test(match[0])
    ? match[0].replace(enabledLine, `enabled = ${enabled}`)
    : match[0].replace(/^([^\n]+\n)/, `$1enabled = ${enabled}\n`);
  return text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
}

function setMcpEnabled(text, server, enabled) {
  const escaped = server.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = new RegExp(`^\\[mcp_servers(?:\\."${escaped}"|\\.${escaped})\\][ \\t]*\\n[\\s\\S]*?(?=^\\[|(?![\\s\\S]))`, "m");
  const match = text.match(section);
  if (!match) return text;
  const enabledLine = /^enabled\s*=.*$/m;
  const replacement = enabledLine.test(match[0])
    ? match[0].replace(enabledLine, `enabled = ${enabled}`)
    : match[0].replace(/^([^\n]+\n)/, `$1enabled = ${enabled}\n`);
  return text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
}

function directMcpServerNames(text) {
  return [...text.matchAll(/^\[mcp_servers(?:\."([^"]+)"|\.([A-Za-z0-9_-]+))\][ \t]*$/gm)]
    .map((match) => match[1] || match[2]);
}

function directPluginNames(text) {
  return [...text.matchAll(/^\[plugins\."([^"]+)"\][ \t]*$/gm)].map((match) => match[1]);
}

async function backupFile(source, backupRoot, home, manifest) {
  const relative = path.relative(home, source);
  const destination = path.join(backupRoot, "files", relative);
  const present = await exists(source);
  if (present) {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination);
  }
  manifest.files.push({ source, backup: present ? destination : null, existed: present });
}

async function moveDeferred(sourceRoot, destinationRoot, keep, manifest) {
  if (!await exists(sourceRoot)) return;
  if ((await lstat(sourceRoot)).isSymbolicLink()) {
    manifest.skippedSkillRoots.push({ source: sourceRoot, reason: "symbolic-link-root" });
    return;
  }
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (await exists(destination)) throw new Error(`Deferred Skill destination already exists: ${destination}`);
    try {
      await rename(source, destination);
      manifest.movedSkills.push({ source, destination });
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      manifest.skippedSkills.push({ source, destination, reason: "cross-device-boundary" });
    }
  }
}

function pluginProfile(plugin) {
  return `[features]\nplugins = true\nremote_plugin = false\n\n[plugins."${plugin}"]\nenabled = true\n`;
}

async function writeProfiles(codexHome, taskTreeEntry) {
  if (await exists(taskTreeEntry)) {
    await atomicWrite(path.join(codexHome, "task-tree.config.toml"), `[features]\nenable_mcp_apps = true\nremote_plugin = false\n\n[mcp_servers.task_tree]\ncommand = '${process.execPath}'\nargs = ['${taskTreeEntry}']\nstartup_timeout_sec = 30\n`);
  }
  for (const plugin of PLUGINS) {
    await atomicWrite(path.join(codexHome, `${plugin.split("@")[0]}.config.toml`), pluginProfile(plugin));
  }
  const taskTree = await exists(taskTreeEntry)
    ? `\n[mcp_servers.task_tree]\ncommand = '${process.execPath}'\nargs = ['${taskTreeEntry}']\nstartup_timeout_sec = 30\n`
    : "";
  const pluginSections = PLUGINS.map((plugin) => `\n[plugins."${plugin}"]\nenabled = true\n`).join("");
  await atomicWrite(path.join(codexHome, "full-tools.config.toml"), `[features]\nenable_mcp_apps = true\nmulti_agent = false\nplugins = true\nremote_plugin = false\n${taskTree}${pluginSections}`);
}

async function refreshRegistry(codexHome, home) {
  const hook = path.join(codexHome, "hooks", "refresh-skill-registry.mjs");
  if (!await exists(hook)) return;
  const result = spawnSync(process.execPath, [hook], {
    encoding: "utf8",
    input: `${JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: home })}\n`,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome }
  });
  if (result.status !== 0) throw new Error(`Skill registry refresh failed: ${result.stderr || result.stdout}`);
}

async function restoreManifest(manifest) {
  for (const file of manifest.files) {
    if (file.backup) await copyFile(file.backup, file.source);
    else if (await exists(file.source)) await unlink(file.source);
  }
  for (const moved of [...manifest.movedSkills].reverse()) {
    if (await exists(moved.destination) && !await exists(moved.source)) await rename(moved.destination, moved.source);
  }
}

async function restore(options) {
  const manifest = JSON.parse(await readFile(path.join(options.restore, "manifest.json"), "utf8"));
  await restoreManifest(manifest);
  console.log(`Restored lazy capability backup: ${options.restore}`);
}

async function apply(options) {
  const codexHome = path.join(options.home, ".codex");
  const agentsHome = path.join(options.home, ".agents");
  const configPath = path.join(codexHome, "config.toml");
  if (!await exists(configPath)) throw new Error(`Codex config not found: ${configPath}`);
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupRoot = path.join(codexHome, "backups", "lazy-capabilities", timestamp);
  const manifest = {
    schemaVersion: "codex-lazy-capabilities-linux/1",
    createdAt: new Date().toISOString(),
    files: [],
    movedSkills: [],
    skippedSkills: [],
    skippedSkillRoots: []
  };
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await backupFile(configPath, backupRoot, options.home, manifest);
  for (const profile of PROFILE_NAMES) await backupFile(path.join(codexHome, `${profile}.config.toml`), backupRoot, options.home, manifest);
  for (const registryFile of ["skills-index.json", "deferred-skills.tsv", "routing-rules.json"]) {
    await backupFile(path.join(codexHome, "skill-registry", registryFile), backupRoot, options.home, manifest);
  }

  try {
    let config = await readFile(configPath, "utf8");
    for (const [name, value] of [["enable_mcp_apps", false], ["multi_agent", false], ["plugins", false], ["remote_plugin", false]]) {
      config = setFeature(config, name, value);
    }
    for (const plugin of new Set([...PLUGINS, ...directPluginNames(config)])) config = setPluginEnabled(config, plugin, false);
    for (const server of directMcpServerNames(config)) config = setMcpEnabled(config, server, false);
    await atomicWrite(configPath, config);
    await writeProfiles(codexHome, options.taskTreeEntry);

    await moveDeferred(path.join(codexHome, "skills"), path.join(codexHome, "deferred-skills", "codex"), new Set([".system"]), manifest);
    await moveDeferred(path.join(agentsHome, "skills"), path.join(agentsHome, "deferred-skills"), CORE_AGENT_SKILLS, manifest);
    await atomicWrite(path.join(backupRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await refreshRegistry(codexHome, options.home);
  } catch (error) {
    await restoreManifest(manifest);
    throw new Error(`Lazy capability configuration failed and was restored: ${error.message}`);
  }
  console.log(`Applied Linux lazy capability loading. Backup: ${backupRoot}`);
  console.log(`Moved Skills: ${manifest.movedSkills.length}`);
  console.log(`Skipped Skills: ${manifest.skippedSkills.length}; skipped roots: ${manifest.skippedSkillRoots.length}`);
}

const options = parseArgs(process.argv.slice(2));
if (options.restore) await restore(options);
else await apply(options);
