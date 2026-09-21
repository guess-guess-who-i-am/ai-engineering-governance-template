#!/usr/bin/env node
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.dirname(SCRIPT_DIR);
const LAUNCHER = path.join(REPOSITORY_ROOT, "Deploy Codex Profile.app", "Contents", "MacOS", "deploy");
const APP = path.join(REPOSITORY_ROOT, "Deploy Codex Profile.app");

function assert(condition, message) { if (!condition) throw new Error(message); }
function run(args, home) {
  return spawnSync(LAUNCHER, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_PROFILE_LAUNCHER_NO_DIALOG: "1" }
  });
}
function runLaunchServices(args) {
  return spawnSync("/usr/bin/open", ["-W", "-n", APP, "--args", ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: { ...process.env, CODEX_PROFILE_LAUNCHER_NO_DIALOG: "1" }
  });
}

const root = await mkdtemp(path.join(os.tmpdir(), "codex-profile-launcher-test-"));
try {
  const home = path.join(root, "home");
  await mkdir(home, { recursive: true });
  const direct = run(["--repo", REPOSITORY_ROOT, "--home", home, "--no-dialog"], home);
  assert(direct.status === 0, `launcher failed with explicit repository: ${direct.stderr || direct.stdout}`);
  assert(direct.stdout.includes("此电脑上的所有 Codex 工作区"), "launcher did not report global scope");
  assert((await readFile(path.join(home, ".codex", "config.toml"), "utf8")).includes('web_search = "live"'), "launcher did not deploy profile");

  const secondHome = path.join(root, "second-home");
  await mkdir(secondHome, { recursive: true });
  const positional = run([REPOSITORY_ROOT, "--home", secondHome, "--no-dialog"], secondHome);
  assert(positional.status === 0, `launcher did not accept a Finder-style folder argument: ${positional.stderr || positional.stdout}`);
  const repeat = run(["--repo", REPOSITORY_ROOT, "--home", secondHome, "--no-dialog"], secondHome);
  assert(repeat.status === 0 && repeat.stdout.includes("available to every Codex workspace"), "repeat launcher deployment was not idempotent");

  const plist = spawnSync("/usr/bin/plutil", ["-p", path.join(APP, "Contents", "Info.plist")], { encoding: "utf8" });
  assert(plist.status === 0 && plist.stdout.includes('"public.folder"'), "app is not registered for Finder folders");
  await access(path.join(APP, "Contents", "MacOS", "deploy"));
  const launchHome = path.join(root, "launchservices-home");
  await mkdir(launchHome, { recursive: true });
  const launched = runLaunchServices(["--repo", REPOSITORY_ROOT, "--home", launchHome, "--no-dialog"]);
  assert(launched.status === 0 && (await readFile(path.join(launchHome, ".codex", "config.toml"), "utf8")).includes('web_search = "live"'), "Finder LaunchServices invocation did not deploy the profile");
  const relaunched = runLaunchServices(["--repo", REPOSITORY_ROOT, "--home", launchHome, "--no-dialog"]);
  assert(relaunched.status === 0, "profile could not be deployed again after the launcher process exited");

  const invalid = path.join(root, "not-a-repository");
  await mkdir(invalid, { recursive: true });
  const failure = run([invalid, "--home", path.join(root, "failure-home"), "--no-dialog"], home);
  assert(failure.status !== 0 && (failure.stdout + failure.stderr).includes("不是治理模板仓库"), "invalid folder did not produce actionable failure");
  console.log("PASS: Finder folder registration, LaunchServices right-click invocation, relaunch persistence, global scope reporting, idempotent repeat, and actionable invalid-folder failure.");
} finally {
  await rm(root, { recursive: true, force: true });
}
