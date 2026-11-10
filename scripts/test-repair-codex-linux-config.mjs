#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = await mkdtemp(path.join(os.tmpdir(), "codex-linux-config-test-"));
const codexHome = path.join(root, ".codex");
await mkdir(codexHome, { recursive: true });
await writeFile(path.join(codexHome, "config.toml"), `model_provider = "custom"
model = "gpt-5.6-sol"
notify = ["C:\\\\bad.exe"]

[model_providers.custom]
base_url = "http://127.0.0.1:1454/v1"

[projects.'C:\\\\work']
trust_level = "trusted"

[projects."/home/test/project"]
trust_level = "trusted"

[mcp_servers.node_repl]
command = 'C:\\\\node.exe'

[features]
enable_mcp_apps = true
multi_agent = true

[hooks.state."/home/test/.codex/hooks.json:user_prompt_submit:0:0"]
trusted_hash = "current"

[hooks.state."/home/test/.codex/hooks.json:user_prompt_submit:0:1"]
trusted_hash = "old"

[marketplaces.openai-bundled]
source_type = "local"
source = "/home/test/.codex/.tmp/bundled-marketplaces/openai-bundled"
`);

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "repair-codex-linux-config.mjs");
const result = spawnSync(process.execPath, [script, "--home", root, "--json"], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
const output = JSON.parse(result.stdout);
assert.equal(output.status, "repaired");
assert.ok(output.backupDirectory);

const repaired = await readFile(path.join(codexHome, "config.toml"), "utf8");
assert.match(repaired, /model = "gpt-5\.6-sol"/);
assert.match(repaired, /projects\."\/home\/test\/project"/);
assert.match(repaired, /enable_mcp_apps = false/);
assert.match(repaired, /multi_agent = false/);
assert.doesNotMatch(repaired, /C:\\\\/);
assert.doesNotMatch(repaired, /mcp_servers/);
assert.match(repaired, /trusted_hash = "current"/);
assert.doesNotMatch(repaired, /trusted_hash = "old"/);
assert.match(repaired, /marketplaces\.openai-bundled/);

const check = spawnSync(process.execPath, [script, "--home", root, "--check", "--json"], { encoding: "utf8" });
assert.equal(check.status, 0, check.stderr);
assert.equal(JSON.parse(check.stdout).status, "current");
console.log("PASS: Linux Codex config repair removes cross-OS state, preserves Linux settings, backs up, and is idempotent.");
