#!/usr/bin/env node
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const KEEP_SECTIONS = [
  /^model_providers\.custom$/,
  /^sandbox_workspace_write$/,
  /^projects\.["']\/[^"']+["']$/,
  /^desktop$/,
  /^features$/,
  /^tui\.model_availability_nux$/,
  /^marketplaces\.openai-bundled$/,
  /^hooks\.state$/,
  /^hooks\.state\.["']\/.+\/\.codex\/hooks\.json:(?:session_start|user_prompt_submit):0:0["']$/
];

function parseArgs(argv) {
  const options = { home: os.homedir(), check: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--home") options.home = path.resolve(argv[++index]);
    else if (arg === "--check") options.check = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function sectionName(line) {
  const match = line.trim().match(/^\[([^\]]+)]$/);
  return match?.[1] || "";
}

function isWindowsValue(line) {
  return /(?:^|["'=\s])[a-z]:\\\\/i.test(line) || line.includes("\\\\?\\C:\\");
}

function cleanConfig(source) {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  const preamble = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const name = sectionName(line);
    if (name) {
      current = { name, lines: [line.trim()] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }

  const cleanedPreamble = preamble.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("notify =")) return false;
    if (trimmed.startsWith("suppress_unstable_features_warning =")) return false;
    return !isWindowsValue(line);
  });
  while (cleanedPreamble.length && !cleanedPreamble.at(-1).trim()) cleanedPreamble.pop();
  cleanedPreamble.push("suppress_unstable_features_warning = true");

  const normalizedFeatures = [
    "[features]",
    "enable_mcp_apps = false",
    "js_repl = false",
    "multi_agent = false"
  ];
  const keptSections = sections.filter((section) =>
    KEEP_SECTIONS.some((pattern) => pattern.test(section.name))
  );
  const kept = keptSections.map((section) =>
    section.name === "features"
      ? normalizedFeatures
      : section.lines.filter((line) => !isWindowsValue(line))
  );
  if (!keptSections.some((section) => section.name === "features")) kept.push(normalizedFeatures);

  const blocks = [cleanedPreamble, ...kept]
    .map((block) => block.join("\n").trim())
    .filter(Boolean);
  return `${blocks.join("\n\n")}\n`;
}

function backupId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function atomicWrite(file, content) {
  const temporary = `${file}.linux-repair-${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configFile = path.join(options.home, ".codex", "config.toml");
  const source = await readFile(configFile, "utf8");
  const cleaned = cleanConfig(source);
  const changed = source !== cleaned;
  const remainingWindowsPaths = cleaned.split(/\r?\n/).filter(isWindowsValue);
  if (remainingWindowsPaths.length) throw new Error("cleaned config still contains Windows paths");

  let backupDirectory = null;
  if (changed && !options.check) {
    backupDirectory = path.join(options.home, ".codex", "backups", "linux-config-repair", backupId());
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    await copyFile(configFile, path.join(backupDirectory, "config.toml"));
    await chmod(path.join(backupDirectory, "config.toml"), 0o600);
    await atomicWrite(configFile, cleaned);
  }

  const result = {
    status: options.check ? (changed ? "changes-required" : "current") : (changed ? "repaired" : "already-current"),
    configFile,
    backupDirectory,
    windowsPaths: remainingWindowsPaths.length,
    mcpServers: 0,
    multiAgent: false
  };
  if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else console.log(result);
  if (options.check && changed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`Linux Codex config repair failed: ${error.message}`);
  process.exitCode = 1;
});
