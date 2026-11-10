#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runner = path.join(repositoryRoot, "scripts", "parallel-run.mjs");
const root = await mkdtemp(path.join(os.tmpdir(), "adaptive-parallel-run-"));

function task(id, delayMs, options = {}) {
  return {
    id,
    command: process.execPath,
    args: ["-e", `setTimeout(() => process.exit(${options.exitCode ?? 0}), ${delayMs})`],
    ...options
  };
}

async function execute(name, plan, expectedStatus = 0) {
  const planPath = path.join(root, `${name}.json`);
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const result = spawnSync(process.execPath, [runner, planPath], { encoding: "utf8" });
  assert.equal(result.status, expectedStatus, `${name} exited ${result.status}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

try {
  const overlap = await execute("overlap", {
    initialConcurrency: 4,
    maxConcurrency: 8,
    tasks: ["a", "b", "c", "d"].map((id) => task(id, 180))
  });
  assert.equal(overlap.peakConcurrency, 4);
  const firstWave = overlap.results.filter((result) => result.wave === 1);
  assert.equal(firstWave.length, 4);
  assert(Math.max(...firstWave.map((result) => result.startedAt)) < Math.min(...firstWave.map((result) => result.endedAt)));

  const dependency = await execute("dependency", {
    tasks: [
      task("source", 100),
      task("consumer", 20, { dependsOn: ["source"] })
    ]
  });
  const source = dependency.results.find((result) => result.id === "source");
  const consumer = dependency.results.find((result) => result.id === "consumer");
  assert(consumer.startedAt >= source.endedAt, "dependent task overlapped its prerequisite");

  const backpressure = await execute("backpressure", {
    initialConcurrency: 4,
    maxConcurrency: 10,
    tasks: [
      task("fail", 30, { exitCode: 7 }),
      task("first-2", 80),
      task("first-3", 80),
      task("first-4", 80),
      task("second-1", 60),
      task("second-2", 60),
      task("second-3", 60),
      task("second-4", 60)
    ]
  }, 1);
  assert.equal(backpressure.waves[0].concurrencyAfter, 2);
  assert.equal(backpressure.waves[1].taskIds.length, 2);

  const serial = await execute("serial-safety", {
    initialConcurrency: 4,
    tasks: [
      task("mutation", 80, { safety: "stateful" }),
      task("read-1", 100),
      task("read-2", 100)
    ]
  });
  assert.deepEqual(serial.waves[0].taskIds, ["mutation"]);
  assert(serial.results.find((result) => result.id === "read-1").startedAt >= serial.results.find((result) => result.id === "mutation").endedAt);

  const ceiling = await execute("hard-ceiling", {
    initialConcurrency: 20,
    maxConcurrency: 20,
    tasks: Array.from({ length: 25 }, (_, index) => task(`task-${index + 1}`, 40))
  });
  assert.equal(ceiling.peakConcurrency, 20);
  assert(ceiling.waves.every((wave) => wave.taskIds.length <= 20));

  const timeout = await execute("timeout", {
    initialConcurrency: 2,
    tasks: [
      task("slow", 500, { timeoutMs: 30 }),
      task("peer", 80),
      task("after", 20)
    ]
  }, 1);
  assert.equal(timeout.results.find((result) => result.id === "slow").code, 124);
  assert.equal(timeout.waves[0].concurrencyAfter, 1);

  const invalidPath = path.join(root, "invalid.json");
  await writeFile(invalidPath, JSON.stringify({ maxConcurrency: 21, tasks: [task("x", 1)] }));
  const invalid = spawnSync(process.execPath, [runner, invalidPath], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /maxConcurrency must be an integer from 1 to 20/);

  console.log("PASS: adaptive DAG waves, overlap, dependency ordering, failure/timeout backpressure, serial safety, and hard 20 ceiling");
} finally {
  await rm(root, { recursive: true, force: true });
}
