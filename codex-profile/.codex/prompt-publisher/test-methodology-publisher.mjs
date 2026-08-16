import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRuntimeSource } from "./publish-global-prompt.mjs";
import { parseRoutedSections, validateSourceSections } from "./publish-methodology.mjs";

const directory = new URL("./", import.meta.url);
const config = JSON.parse(await readFile(new URL("methodology-targets.json", directory), "utf8"));
const source = buildRuntimeSource(await readFile(new URL(config.sourceFile, directory), "utf8"));
const sections = parseRoutedSections(source);
const rules = validateSourceSections(sections, config.routes);

assert.equal(sections.size, 7);
assert.equal([...rules.values()].reduce((sum, routeRules) => sum + routeRules.length, 0), 55);
assert.deepEqual(Object.fromEntries([...rules].map(([route, routeRules]) => [route, routeRules.length])), {
  alwaysOn: 21,
  "method-research-evidence": 5,
  "method-engineering-execution": 12,
  "method-evaluation-gates": 6,
  "method-github-delivery": 1,
  "method-task-tree": 10
});

const githubRule = rules.get("method-github-delivery")[0];
const duplicate = source.replace("## `method-task-tree`", `${githubRule}\n\n## \`method-task-tree\``);
assert.throws(() => validateSourceSections(parseRoutedSections(duplicate), config.routes), /规则在多个位置重复/);

const unknown = `${source.trimEnd()}\n\n## \`method-unregistered\`\n\n- 未登记规则\n`;
assert.throws(() => validateSourceSections(parseRoutedSections(unknown), config.routes), /发现未配置分类/);

console.log("PASS: methodology publisher source parsing, route counts, duplicate rejection, and unknown-route rejection.");
