#!/usr/bin/env node
/**
 * Execute a dependency DAG in adaptive waves.
 *
 * Concurrency starts conservatively, grows after successful waves, shrinks after
 * failures or timeouts, and never exceeds the hard ceiling of 20. Stateful,
 * destructive, and rate-limited tasks always run alone.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const HARD_MAX_CONCURRENCY = 20;
const DEFAULT_INITIAL_CONCURRENCY = 4;
const SERIAL_SAFETY = new Set(["stateful", "destructive", "rate-limited"]);
const VALID_SAFETY = new Set(["read-only", ...SERIAL_SAFETY]);
const specPath = process.argv[2];

if (!specPath) {
  console.error("Usage: parallel-run.mjs plan.json");
  process.exit(2);
}

const plan = JSON.parse(await readFile(specPath, "utf8"));
if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
  throw new Error("plan.json must be an object");
}

const tasks = plan.tasks;
if (!Array.isArray(tasks) || tasks.length === 0) {
  throw new Error("plan.tasks must contain at least one task");
}

const maxConcurrency = plan.maxConcurrency ?? HARD_MAX_CONCURRENCY;
const initialConcurrency = plan.initialConcurrency ?? Math.min(DEFAULT_INITIAL_CONCURRENCY, maxConcurrency);
if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > HARD_MAX_CONCURRENCY) {
  throw new Error(`maxConcurrency must be an integer from 1 to ${HARD_MAX_CONCURRENCY}`);
}
if (!Number.isInteger(initialConcurrency) || initialConcurrency < 1 || initialConcurrency > maxConcurrency) {
  throw new Error("initialConcurrency must be an integer from 1 to maxConcurrency");
}

const taskById = new Map();
for (const [index, task] of tasks.entries()) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`task ${index} is invalid`);
  if (typeof task.id !== "string" || !task.id) throw new Error(`task ${index} needs a non-empty id`);
  if (taskById.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
  if (typeof task.command !== "string" || !task.command) throw new Error(`task ${task.id} needs a command`);
  if (task.dependsOn !== undefined && !Array.isArray(task.dependsOn)) throw new Error(`task ${task.id} dependsOn must be an array`);
  if (task.safety !== undefined && !VALID_SAFETY.has(task.safety)) {
    throw new Error(`task ${task.id} safety must be read-only, stateful, destructive, or rate-limited`);
  }
  taskById.set(task.id, {
    ...task,
    args: Array.isArray(task.args) ? task.args.map(String) : [],
    dependsOn: task.dependsOn ?? [],
    safety: task.safety ?? "read-only"
  });
}

for (const task of taskById.values()) {
  for (const dependency of task.dependsOn) {
    if (typeof dependency !== "string" || !taskById.has(dependency)) {
      throw new Error(`task ${task.id} has unknown dependency: ${dependency}`);
    }
    if (dependency === task.id) throw new Error(`task ${task.id} cannot depend on itself`);
  }
}

function assertAcyclic() {
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`dependency cycle detected at task ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of taskById.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of taskById.keys()) visit(id);
}
assertAcyclic();

function runTask(task, wave) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(task.command, task.args, {
      cwd: task.cwd || process.cwd(),
      env: { ...process.env, ...(task.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let forceKillTimer;
    const timeoutMs = Number.isFinite(task.timeoutMs) && task.timeoutMs > 0 ? Number(task.timeoutMs) : 0;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs) : undefined;

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({
        id: task.id,
        wave,
        safety: task.safety,
        code: timedOut ? 124 : result.code,
        timedOut,
        error: result.error,
        startedAt,
        endedAt: Date.now(),
        stdout,
        stderr
      });
    }

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ code: 1, error: error.message }));
    child.on("close", (code, signal) => finish({
      code: Number.isInteger(code) ? code : 1,
      error: signal && !timedOut ? `terminated by ${signal}` : undefined
    }));
  });
}

const pending = new Set(taskById.keys());
const completed = new Map();
const results = [];
const waves = [];
let currentConcurrency = initialConcurrency;
let peakConcurrency = 0;
let waveNumber = 0;

while (pending.size > 0) {
  const blocked = [...pending].filter((id) =>
    taskById.get(id).dependsOn.some((dependency) =>
      completed.has(dependency) && completed.get(dependency)?.code !== 0
    )
  );
  for (const id of blocked) {
    pending.delete(id);
    const result = {
      id,
      wave: null,
      safety: taskById.get(id).safety,
      code: null,
      skipped: true,
      reason: "dependency failed"
    };
    completed.set(id, result);
    results.push(result);
  }
  if (pending.size === 0) break;

  const ready = [...pending].map((id) => taskById.get(id)).filter((task) =>
    task.dependsOn.every((dependency) => completed.get(dependency)?.code === 0)
  );
  if (ready.length === 0) throw new Error("no runnable tasks remain");

  const serialTask = ready.find((task) => SERIAL_SAFETY.has(task.safety));
  const selected = serialTask ? [serialTask] : ready.slice(0, currentConcurrency);
  waveNumber += 1;
  const concurrencyBefore = currentConcurrency;
  const startedAt = Date.now();
  peakConcurrency = Math.max(peakConcurrency, selected.length);
  const waveResults = await Promise.all(selected.map((task) => runTask(task, waveNumber)));
  const endedAt = Date.now();

  for (const result of waveResults) {
    pending.delete(result.id);
    completed.set(result.id, result);
    results.push(result);
  }

  const failed = waveResults.some((result) => result.code !== 0);
  currentConcurrency = failed
    ? Math.max(1, Math.floor(currentConcurrency / 2))
    : Math.min(maxConcurrency, currentConcurrency + 1);
  waves.push({
    wave: waveNumber,
    taskIds: selected.map((task) => task.id),
    concurrencyBefore,
    concurrencyAfter: currentConcurrency,
    startedAt,
    endedAt,
    failed
  });
}

const failedCount = results.filter((result) => typeof result.code === "number" && result.code !== 0).length;
const skippedCount = results.filter((result) => result.skipped).length;
process.stdout.write(`${JSON.stringify({
  hardMaxConcurrency: HARD_MAX_CONCURRENCY,
  maxConcurrency,
  initialConcurrency,
  finalConcurrency: currentConcurrency,
  peakConcurrency,
  count: tasks.length,
  failedCount,
  skippedCount,
  waves,
  results
}, null, 2)}\n`);
process.exitCode = failedCount > 0 || skippedCount > 0 ? 1 : 0;
