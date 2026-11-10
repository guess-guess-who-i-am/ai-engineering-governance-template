#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const codexRoot = process.env.CODEX_HOME || path.join(home, ".codex");

function lines(text) { return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n"); }
function rules(text) { return lines(text).filter((line) => line.startsWith("- ")); }

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--config")) throw new Error("Usage: validate-methodology-routing.mjs [--config path]");
  const configFile = path.resolve(args[1] || path.join(codexRoot, "prompt-publisher", "methodology-targets.json"));
  const config = JSON.parse(await readFile(configFile, "utf8"));
  const resolve = file => path.resolve(path.dirname(configFile), file);
  const outputs = Object.fromEntries(Object.entries(config.outputs).map(([key, file]) => [key, resolve(file)]));
  const targets = { alwaysOn: outputs.anchorEnglish,
    ...Object.fromEntries(config.routes.filter(route => route.skillFile).map(route => [route.id, resolve(route.skillFile)])) };
  const [sourceText, chineseText, chineseAnchorText, reviewText, mapText, ...targetTexts] = await Promise.all([
    readFile(outputs.fullEnglish, "utf8"),
    readFile(outputs.fullChinese, "utf8"),
    readFile(outputs.anchorChinese, "utf8"),
    readFile(outputs.chineseReview, "utf8"),
    readFile(outputs.map, "utf8"),
    ...Object.values(targets).map((file) => readFile(file, "utf8"))
  ]);
  const sourceRules = rules(sourceText);
  const chineseRules = rules(chineseText);
  const chineseAnchorLines = lines(chineseAnchorText);
  const reviewRules = rules(reviewText);
  const map = JSON.parse(mapText);
  const targetEntries = Object.keys(targets).map((route, index) => [route, targetTexts[index]]);
  const targetLines = Object.fromEntries(targetEntries.map(([route, text]) => [route, lines(text)]));
  const errors = [];
  if (sourceRules.length !== map.ruleCount) errors.push(`Source has ${sourceRules.length} rules; map declares ${map.ruleCount}.`);
  if (chineseRules.length !== map.ruleCount) errors.push(`Chinese review source has ${chineseRules.length} rules; map declares ${map.ruleCount}.`);
  const owners = new Map();
  for (const [route, ids] of Object.entries(map.routes)) {
    if (!targets[route]) { errors.push(`No target configured for route: ${route}`); continue; }
    for (const rawId of ids) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id < 1 || id > sourceRules.length) { errors.push(`Out-of-range rule ${rawId} in ${route}`); continue; }
      if (owners.has(id)) errors.push(`Rule ${id} is duplicated in ${owners.get(id)} and ${route}`);
      else owners.set(id, route);
      if (!targetLines[route].includes(sourceRules[id - 1])) errors.push(`Rule ${id} is not an exact line in ${route} target`);
    }
  }
  for (let id = 1; id <= sourceRules.length; id += 1) {
    if (!owners.has(id)) errors.push(`Rule ${id} has no route`);
    if (chineseAnchorLines.includes(chineseRules[id - 1]) !== (owners.get(id) === "alwaysOn")) {
      errors.push(`Chinese always-on mirror ownership mismatch for rule ${id}`);
    }
    const reviewMatches = reviewRules.filter((rule) => rule === chineseRules[id - 1]).length;
    if (reviewMatches !== 1) errors.push(`Chinese review rule ${id} appears ${reviewMatches} times; expected exactly once`);
  }
  if (reviewRules.length !== chineseRules.length) errors.push(`Chinese routed review has ${reviewRules.length} rules; expected ${chineseRules.length}.`);
  for (const [route, text] of targetEntries) {
    for (let id = 1; id <= sourceRules.length; id += 1) {
      if (targetLines[route].includes(sourceRules[id - 1]) && owners.get(id) !== route) {
        errors.push(`Rule ${id} appears in ${route} but is owned by ${owners.get(id)}`);
      }
    }
    if (route !== "alwaysOn") {
      const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const description = text.match(/^description:\s*(.+)$/m)?.[1]?.trim();
      if (name !== route) errors.push(`Skill frontmatter name does not match route: ${route}`);
      if (!description) errors.push(`Skill frontmatter description is missing: ${route}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(`PASS: ${sourceRules.length} English rules are assigned exactly once and preserved verbatim; the Chinese review mirrors also match all source rules exactly once.\n`);
  for (const [route, ids] of Object.entries(map.routes)) process.stdout.write(`${route}: ${ids.length} rules\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
