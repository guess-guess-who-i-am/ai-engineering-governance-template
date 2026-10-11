#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function exists(file) { try { await access(file); return true; } catch { return false; } }

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, 180000);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve();
      else reject(new Error(timedOut ? "Skill library Git operation timed out" : `Skill library Git operation failed (${code}); verify GitHub access and run gh auth login / gh auth setup-git. ${stderr.includes("Authentication") ? "Authentication required." : ""}`));
    });
  });
}

async function validateCatalog(root, catalog, expectedHash) {
  const data = await readFile(catalog);
  if (expectedHash && createHash("sha256").update(data).digest("hex") !== expectedHash) throw new Error("Pinned Skill catalog checksum mismatch");
  const parsed = JSON.parse(data);
  if (!Array.isArray(parsed.skills)) throw new Error("Skill catalog must contain a skills array");
  return { root: path.resolve(root), catalog: path.resolve(catalog), catalogRecords: parsed.skills.length };
}

export async function ensureSkillLibrary({ home = os.homedir(), sourceRoot = repositoryRoot, env = process.env, check = false } = {}) {
  const explicit = env.CODEX_PROFILE_SKILL_SOURCE || env.CODEX_EXTERNAL_SKILL_ROOT;
  const candidates = explicit ? [explicit] : [path.resolve(sourceRoot, "..", "skills"), path.join(home, ".codex", "tools", "skills")];
  for (const root of candidates) {
    const catalog = env.CODEX_PROFILE_SKILL_CATALOG || env.CODEX_EXTERNAL_SKILL_CATALOG || path.join(root, "_catalog_cn.json");
    if (await exists(catalog)) return { ...await validateCatalog(root, catalog), action: "reused" };
  }
  if (explicit) throw new Error("Configured Skill library/catalog is missing; refusing an incomplete deployment");
  if (check) throw new Error("Global Skill library is missing; deploy once with access to the private skills-library repository");

  const lock = JSON.parse(await readFile(path.join(sourceRoot, "codex-profile", "portable-dependencies.json"), "utf8"));
  const dependency = lock.skillLibrary;
  if (!dependency?.repository || !/^[a-f0-9]{40}$/.test(dependency.commit) || !/^[a-f0-9]{64}$/.test(dependency.catalogSha256)) throw new Error("Invalid portable Skill dependency lock");
  const tools = path.join(home, ".codex", "tools");
  const checkout = path.join(tools, "skill-library-source");
  if (await exists(checkout)) {
    return { ...await validateCatalog(checkout, path.join(checkout, "_catalog_cn.json"), dependency.catalogSha256), action: "reused-pinned" };
  }
  await mkdir(tools, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(path.join(tools, ".skill-library-install-"));
  try {
    await git(["init", "--quiet"], temporary);
    await git(["remote", "add", "origin", dependency.repository], temporary);
    await git(["fetch", "--quiet", "--depth", "1", "origin", dependency.commit], temporary);
    await git(["checkout", "--quiet", "--detach", dependency.commit], temporary);
    await validateCatalog(temporary, path.join(temporary, "_catalog_cn.json"), dependency.catalogSha256);
    await rename(temporary, checkout);
    return { ...await validateCatalog(checkout, path.join(checkout, "_catalog_cn.json"), dependency.catalogSha256), action: "cloned-pinned", commit: dependency.commit };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  let json = false;
  let printRoot = false;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--home") { options.home = process.argv[++index]; if (!options.home) throw new Error("--home requires a path"); }
    else if (arg === "--check") options.check = true;
    else if (arg === "--json") json = true;
    else if (arg === "--print-root") printRoot = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  ensureSkillLibrary(options).then((result) => process.stdout.write(json && !printRoot ? `${JSON.stringify(result)}\n` : `${result.root}\n`)).catch((error) => {
    console.error(`Skill library setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
