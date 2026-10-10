#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureSkillLibrary } from "./ensure-global-skill-library.mjs";

const temporary = await mkdtemp(path.join(os.tmpdir(), "codex-skill-restore-"));
const source = path.join(temporary, "private mirror with spaces");
const profile = path.join(temporary, "profile");
const home = path.join(temporary, "new user with spaces");
function git(args) {
  const result = spawnSync("git", ["-C", source, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
try {
  await mkdir(source, { recursive: true });
  await mkdir(path.join(profile, "codex-profile"), { recursive: true });
  const catalog = JSON.stringify({ skills: [{ name: "fixture", dir: "fixture" }] });
  await writeFile(path.join(source, "_catalog_cn.json"), catalog);
  await mkdir(path.join(source, "fixture"));
  await writeFile(path.join(source, "fixture", "SKILL.md"), "---\nname: fixture\ndescription: restore test\n---\nfixture\n");
  git(["init", "--quiet"]);
  git(["add", "."]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  const commit = git(["rev-parse", "HEAD"]);
  const lock = { skillLibrary: { repository: pathToFileURL(source).href, commit, catalogSha256: createHash("sha256").update(catalog).digest("hex") } };
  await writeFile(path.join(profile, "codex-profile", "portable-dependencies.json"), JSON.stringify(lock));
  const options = { home, sourceRoot: profile, env: {} };
  await assert.rejects(ensureSkillLibrary({ ...options, check: true }), /missing/);
  await assert.rejects(access(path.join(home, ".codex")), /ENOENT/);
  // Moving upstream HEAD must not move the restored version.
  await writeFile(path.join(source, "_catalog_cn.json"), '{"skills":[]}');
  git(["add", "."]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "later version"]);
  const installed = await ensureSkillLibrary(options);
  assert.equal(installed.action, "cloned-pinned");
  assert.equal(installed.commit, commit);
  assert.equal(installed.catalogRecords, 1);
  assert.equal(await readFile(installed.catalog, "utf8"), catalog);
  assert.equal((await ensureSkillLibrary(options)).action, "reused-pinned");
  await assert.rejects(ensureSkillLibrary({ ...options, env: { CODEX_PROFILE_SKILL_SOURCE: path.join(temporary, "absent") } }), /Configured/);
  const offline = await ensureSkillLibrary({ ...options, check: true, env: { CODEX_PROFILE_SKILL_SOURCE: installed.root } });
  assert.equal(offline.action, "reused");
  const missingHome = path.join(temporary, "checksum failure home");
  lock.skillLibrary.catalogSha256 = "0".repeat(64);
  await writeFile(path.join(profile, "codex-profile", "portable-dependencies.json"), JSON.stringify(lock));
  await assert.rejects(ensureSkillLibrary({ ...options, home: missingHome }), /checksum/);
  assert.deepEqual(await readdir(path.join(missingHome, ".codex", "tools")), []);
  lock.skillLibrary.repository = pathToFileURL(path.join(temporary, "missing remote")).href;
  await writeFile(path.join(profile, "codex-profile", "portable-dependencies.json"), JSON.stringify(lock));
  await assert.rejects(ensureSkillLibrary({ ...options, home: missingHome }), /Git operation failed/);
  assert.deepEqual(await readdir(path.join(missingHome, ".codex", "tools")), []);
  console.log("PASS: clean-machine pinned Git restore, SHA-256 verification, offline reuse/check, explicit missing source, failure cleanup, paths with spaces; no partial 22-Skill deployment.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
