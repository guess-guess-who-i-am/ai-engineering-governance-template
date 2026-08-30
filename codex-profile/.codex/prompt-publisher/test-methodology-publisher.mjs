import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRuntimeSource, validateTranslation } from "./publish-global-prompt.mjs";
import { buildRouter, parseRoutedSections, validateSourceSections } from "./publish-methodology.mjs";

const directory = new URL("./", import.meta.url);
const config = JSON.parse(await readFile(new URL("methodology-targets.json", directory), "utf8"));
const source = buildRuntimeSource(await readFile(new URL(config.sourceFile, directory), "utf8"));
const sections = parseRoutedSections(source);
const rules = validateSourceSections(sections, config.routes);

assert.equal(sections.size, 7);
assert.equal([...rules.values()].reduce((sum, routeRules) => sum + routeRules.length, 0), 129);
assert.deepEqual(Object.fromEntries([...rules].map(([route, routeRules]) => [route, routeRules.length])), {
  alwaysOn: 46,
  "method-research-evidence": 10,
  "method-engineering-execution": 20,
  "method-evaluation-gates": 11,
  "method-github-delivery": 1,
  "method-task-tree": 41
});

const chineseRouter = buildRouter(sections.get("router"), "zh");
assert.doesNotMatch(chineseRouter, /用户原文/);
assert.match(chineseRouter, /根据当前任务的语义/);
const englishRouter = buildRouter(
  "User's original wording: “Route additions through Skills.”\n\nSelect routes based on the current task.",
  "en"
);
assert.doesNotMatch(englishRouter, /User's original wording/);
assert.match(englishRouter, /Select routes based on the current task/);

const githubRule = rules.get("method-github-delivery")[0];
const duplicate = source.replace("## `method-task-tree`", `${githubRule}\n\n## \`method-task-tree\``);
assert.throws(() => validateSourceSections(parseRoutedSections(duplicate), config.routes), /规则在多个位置重复/);

const unknown = `${source.trimEnd()}\n\n## \`method-unregistered\`\n\n- 未登记规则\n`;
assert.throws(() => validateSourceSections(parseRoutedSections(unknown), config.routes), /发现未配置分类/);

const languageGateSource = "# 标题\n\n- [TT01] 读取 `任务树.md`。";
assert.doesNotThrow(() => validateTranslation(languageGateSource, "# Title\n\n- [TT01] Read `任务树.md`."));
assert.throws(
  () => validateTranslation(languageGateSource, "# Title\n\n- [TT01] 读取 `任务树.md`。"),
  /仍包含未翻译的中文正文/
);
assert.throws(
  () => validateTranslation(languageGateSource, "# Title\n\n- Read [TT01] `任务树.md`."),
  /规则 ID 没有保持在项目符号后的原位置/
);

console.log("PASS: methodology publisher source parsing, route counts, duplicate rejection, unknown-route rejection, and Chinese-leakage rejection.");
