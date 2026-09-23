#!/usr/bin/env node
/** Run independent commands concurrently, capped at 20 workers. */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const MAX_WORKERS = 20;
const specPath = process.argv[2];
if (!specPath) {
  console.error("Usage: parallel-run.mjs commands.json");
  process.exit(2);
}

const specs = JSON.parse(await readFile(specPath, "utf8"));
if (!Array.isArray(specs) || specs.length === 0 || specs.length > MAX_WORKERS) {
  throw new Error(`commands.json must contain 1-${MAX_WORKERS} independent commands`);
}

function run(spec, index) {
  if (!spec || typeof spec.command !== "string" || !spec.command) throw new Error(`command ${index} is invalid`);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(spec.command, Array.isArray(spec.args) ? spec.args.map(String) : [], {
      cwd: spec.cwd || process.cwd(),
      env: { ...process.env, ...(spec.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ index, code: 1, error: error.message, startedAt, endedAt: Date.now(), stdout, stderr }));
    child.on("close", (code) => resolve({ index, code: Number(code), startedAt, endedAt: Date.now(), stdout, stderr }));
  });
}

const results = await Promise.all(specs.map(run));
process.stdout.write(`${JSON.stringify({ maxWorkers: MAX_WORKERS, count: specs.length, results }, null, 2)}\n`);
process.exitCode = results.some((result) => result.code !== 0) ? 1 : 0;
