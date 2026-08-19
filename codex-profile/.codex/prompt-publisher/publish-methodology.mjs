import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeSource,
  translateWithCodex,
  validateTranslation
} from "./publish-global-prompt.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_RULE_MARKER = "## User's original wording — English translation";

function normalizeText(value) {
  return String(value || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trimEnd();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function resolveFrom(base, value) {
  if (!value) return "";
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
}

export function parseRoutedSections(document) {
  const sections = new Map();
  let current = null;
  for (const line of normalizeText(document).split("\n")) {
    const match = line.match(/^##\s+`([^`]+)`(?:\s+.*)?$/);
    if (match) {
      current = match[1];
      if (sections.has(current)) throw new Error(`分类重复：${current}`);
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return new Map([...sections].map(([id, lines]) => [id, normalizeText(lines.join("\n")).trim()]));
}

function sectionRules(section, routeId) {
  const lines = normalizeText(section).split("\n").filter((line) => line.trim());
  const invalid = lines.filter((line) => !line.startsWith("- "));
  if (invalid.length) throw new Error(`分类 ${routeId} 中只能放以 “- ” 开头的规则，发现：${invalid[0]}`);
  if (!lines.length) throw new Error(`分类 ${routeId} 不能为空；如需删除整个分类，请先让 Agent 更新路由配置`);
  return lines;
}

export function validateSourceSections(sections, routes) {
  const expected = new Set(["router", ...routes.map((route) => route.id)]);
  const unknown = [...sections.keys()].filter((id) => !expected.has(id));
  const missing = [...expected].filter((id) => !sections.has(id));
  if (unknown.length) throw new Error(`发现未配置分类：${unknown.join(", ")}。新建分类前先让 Agent 建立 Skill 和触发条件`);
  if (missing.length) throw new Error(`缺少分类：${missing.join(", ")}`);
  if (!normalizeText(sections.get("router"))) throw new Error("router 路由说明不能为空");

  const allRules = [];
  const rulesByRoute = new Map();
  for (const route of routes) {
    const rules = sectionRules(sections.get(route.id), route.id);
    rulesByRoute.set(route.id, rules);
    allRules.push(...rules.map((rule) => ({ route: route.id, rule })));
  }
  const duplicate = allRules.find(({ rule }, index) => allRules.findIndex((item) => item.rule === rule) !== index);
  if (duplicate) throw new Error(`规则在多个位置重复：${duplicate.rule}`);
  return rulesByRoute;
}

function assertTranslatedSections(chineseSections, englishSections, routes) {
  const expected = ["router", ...routes.map((route) => route.id)];
  for (const id of expected) {
    if (!englishSections.has(id)) throw new Error(`英文翻译缺少分类：${id}`);
    if (id === "router") continue;
    const chineseCount = sectionRules(chineseSections.get(id), id).length;
    const englishCount = sectionRules(englishSections.get(id), id).length;
    if (chineseCount !== englishCount) throw new Error(`${id} 翻译前后规则数不一致：${chineseCount} -> ${englishCount}`);
  }
  const unexpected = [...englishSections.keys()].filter((id) => !expected.includes(id));
  if (unexpected.length) throw new Error(`英文翻译产生未知分类：${unexpected.join(", ")}`);
}

function buildArchive(routes, rulesByRoute, language) {
  const lines = language === "zh"
    ? ["# 全局方法论完整档案（中文审阅镜像）", "", "> 只供用户审阅，不会整包注入模型。唯一手工编辑源是 `global-methodology-source.zh.md`。", ""]
    : ["# Global methodology archive", "", "> Canonical English translation. This complete archive is not injected as one block.", ""];
  for (const route of routes) {
    const title = language === "zh" ? route.titleZh : route.titleEn;
    lines.push(`## ${title}`, "", ...rulesByRoute.get(route.id), "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildAnchor(rules, language) {
  if (language === "zh") {
    return `${["# 常驻提醒中文审阅镜像", "", "> 只供用户审阅，不会发送给模型。实际运行源是 `global-attention-anchor.en.md`。以下内容来自中文唯一源，不作概括改写。", "", ...rules].join("\n")}\n`;
  }
  return `${["# Always-on reminders — user's original wording translated into English", "", ...rules].join("\n")}\n`;
}

function buildRouter(section, language) {
  const heading = language === "zh" ? "# 方法论路由中文审阅镜像" : "# Methodology router";
  const note = language === "zh"
    ? "> 只供用户审阅，不会发送给模型。实际运行源是 `global-methodology-router.en.md`。"
    : "> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.";
  return `${[heading, "", note, "", normalizeText(section)].join("\n")}\n`;
}

function buildChineseReview(routes, rulesByRoute) {
  const lines = [
    "# 全局方法论中文归类审阅总表",
    "",
    "> 本文件自动生成，只供用户审阅，不会注入模型。请编辑 `global-methodology-source.zh.md`，不要直接修改本文件。",
    "",
    "## 运行关系",
    "",
    "1. 进入项目时，Codex 一次性读取全局和当前项目的 `AGENTS.md`；运行文件使用英文。",
    "2. 每次用户提示，以及会话启动、恢复、清理和压缩时，Hook 重复注入英文常驻原文和英文方法论路由。",
    "3. Skill 推荐器每次只给出最多4个匹配候选、原因、简介和路径，不注入完整 Skill 索引。",
    "4. 命中专项路由后，Codex 才完整读取对应的英文 `method-*` Skill。完整方法论档案不会整包注入。",
    ""
  ];
  routes.forEach((route, index) => {
    const rules = rulesByRoute.get(route.id);
    lines.push(`## ${index + 1}、${route.titleZh}（${rules.length}条）`, "", ...rules, "");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildMap(routes, rulesByRoute) {
  let nextId = 1;
  const routeMap = {};
  for (const route of routes) {
    const ids = [];
    for (const _rule of rulesByRoute.get(route.id)) ids.push(nextId++);
    routeMap[route.id] = ids;
  }
  return `${JSON.stringify({
    schemaVersion: "methodology-partition/3",
    source: "global-every-turn.en.md",
    chineseReviewSource: "global-every-turn.zh.md",
    chineseEditorSource: "global-methodology-source.zh.md",
    chineseReviewDocument: "global-methodology-routing-review.zh.md",
    ruleCount: nextId - 1,
    translationPolicy: "Each routed rule must be an exact line from the English translation source; summaries do not substitute for source wording.",
    routes: routeMap
  }, null, 2)}\n`;
}

function replaceSkillRules(current, routeId, rules) {
  const normalized = normalizeText(current);
  const index = normalized.indexOf(SKILL_RULE_MARKER);
  if (index < 0) throw new Error(`${routeId} 缺少规则替换标记：${SKILL_RULE_MARKER}`);
  const prefix = normalized.slice(0, index + SKILL_RULE_MARKER.length);
  return `${prefix}\n\n${rules.join("\n")}\n`;
}

async function loadConfig(configFile) {
  const absolute = path.resolve(configFile);
  const base = path.dirname(absolute);
  const raw = JSON.parse(await readFile(absolute, "utf8"));
  const outputs = Object.fromEntries(Object.entries(raw.outputs || {}).map(([key, value]) => [key, resolveFrom(base, value)]));
  const routes = (raw.routes || []).map((route) => ({
    ...route,
    skillFile: resolveFrom(base, route.skillFile)
  }));
  if (!routes.length || routes[0].id !== "alwaysOn") throw new Error("routes 第一项必须是 alwaysOn");
  return {
    ...raw,
    configFile: absolute,
    configDir: base,
    sourceFile: resolveFrom(base, raw.sourceFile),
    stateFile: resolveFrom(base, raw.stateFile || "methodology-state.json"),
    translationCacheFile: resolveFrom(base, raw.translationCacheFile || "methodology-translation-cache.en.md"),
    schemaFile: resolveFrom(base, raw.schemaFile || "translation.schema.json"),
    validatorFile: resolveFrom(base, raw.validatorFile),
    refreshRegistryFile: resolveFrom(base, raw.refreshRegistryFile),
    outputs,
    routes
  };
}

function runProcess(command, args, { cwd, input = "", timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(command)} 超时`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: Number(code), stdout, stderr }); });
    child.stdin.end(input, "utf8");
  });
}

async function writeReplacing(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.methodology-${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  try {
    await rm(file, { force: true });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readState(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function contentEquals(file, content) {
  try { return (await readFile(file)).equals(Buffer.from(content, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function releaseId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function backupAndWrite(artifacts, backupRoot) {
  const originals = [];
  const id = releaseId();
  const backupDirectory = path.join(backupRoot, "methodology-publisher", id);
  await mkdir(backupDirectory, { recursive: true });
  let index = 0;
  for (const [file] of artifacts) {
    let data = null;
    try { data = await readFile(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    originals.push({ file, data });
    if (data) {
      const backupName = `${String(++index).padStart(2, "0")}-${path.basename(file)}`;
      await writeFile(path.join(backupDirectory, backupName), data);
    }
  }
  await writeFile(path.join(backupDirectory, "manifest.json"), `${JSON.stringify({
    createdAt: new Date().toISOString(),
    files: originals.map(({ file, data }) => ({ file, existed: data !== null }))
  }, null, 2)}\n`);

  try {
    for (const [file, content] of artifacts) await writeReplacing(file, content);
  } catch (error) {
    for (const original of originals.reverse()) {
      if (original.data === null) await rm(original.file, { force: true });
      else await writeReplacing(original.file, original.data);
    }
    throw error;
  }
  return { backupDirectory, originals };
}

async function rollback(originals) {
  for (const original of [...originals].reverse()) {
    if (original.data === null) await rm(original.file, { force: true });
    else await writeReplacing(original.file, original.data);
  }
}

async function runPostPublish(config) {
  const invocation = (file) => {
    const extension = path.extname(file).toLowerCase();
    if ([".js", ".cjs", ".mjs"].includes(extension)) return { command: process.execPath, args: [file] };
    if (extension === ".ps1") {
      const command = process.platform === "win32"
        ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        : "pwsh";
      return { command, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file] };
    }
    throw new Error(`不支持的发布后脚本类型：${file}`);
  };
  const validator = invocation(config.validatorFile);
  const validate = await runProcess(validator.command, validator.args, { timeoutMs: 30000 });
  if (validate.code !== 0) throw new Error(`方法论完整性校验失败：${`${validate.stderr}\n${validate.stdout}`.trim()}`);
  const refreshInput = `${JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: path.dirname(config.sourceFile) })}\n`;
  const refresher = invocation(config.refreshRegistryFile);
  const refresh = await runProcess(refresher.command, refresher.args, {
    input: refreshInput,
    timeoutMs: Number(config.registryRefreshTimeoutMs || 120000)
  });
  if (refresh.code !== 0) throw new Error(`Skill 索引刷新失败：${`${refresh.stderr}\n${refresh.stdout}`.trim()}`);
  return validate.stdout.trim();
}

export async function publishMethodology(config, { force = false, dryRun = false, check = false } = {}) {
  const sourceText = await readFile(config.sourceFile, "utf8");
  const runtimeSource = buildRuntimeSource(sourceText);
  const chineseSections = parseRoutedSections(runtimeSource);
  const chineseRules = validateSourceSections(chineseSections, config.routes);
  if (check) {
    const state = await readState(config.stateFile);
    const currentSourceSha256 = sha256(runtimeSource);
    if (state.runtimeSourceSha256 !== currentSourceSha256) {
      throw new Error("当前中文方法论源已变化，发布结果过期；请先重新发布，再执行 --check。");
    }
    const validation = await runPostPublish(config);
    return { status: "checked", translated: false, ruleCount: [...chineseRules.values()].reduce((sum, rules) => sum + rules.length, 0), validation };
  }

  const runtimeSourceSha256 = sha256(runtimeSource);
  const state = await readState(config.stateFile);
  let translatedDocument = "";
  let translated = false;
  if (!force && state.runtimeSourceSha256 === runtimeSourceSha256 && existsSync(config.translationCacheFile)) {
    translatedDocument = `${normalizeText(await readFile(config.translationCacheFile, "utf8"))}\n`;
    validateTranslation(runtimeSource, translatedDocument);
  } else {
    const result = await translateWithCodex(runtimeSource, config);
    translatedDocument = result.english;
    translated = true;
  }

  const englishSections = parseRoutedSections(translatedDocument);
  assertTranslatedSections(chineseSections, englishSections, config.routes);
  const englishRules = new Map(config.routes.map((route) => [route.id, sectionRules(englishSections.get(route.id), route.id)]));
  const ruleCount = [...chineseRules.values()].reduce((sum, rules) => sum + rules.length, 0);

  const fullChinese = buildArchive(config.routes, chineseRules, "zh");
  const fullEnglish = buildArchive(config.routes, englishRules, "en");
  const anchorChinese = buildAnchor(chineseRules.get("alwaysOn"), "zh");
  const anchorEnglish = buildAnchor(englishRules.get("alwaysOn"), "en");
  const routerChinese = buildRouter(chineseSections.get("router"), "zh");
  const routerEnglish = buildRouter(englishSections.get("router"), "en");
  const contextCharacters = anchorEnglish.trim().length + routerEnglish.trim().length + Number(config.contextReserve || 500);
  if (contextCharacters > Number(config.contextLimit || 8000)) {
    throw new Error(`常驻包和路由预计 ${contextCharacters} 字符，超过 ${config.contextLimit} 上限；请把部分规则移入专项 Skill`);
  }

  const artifacts = new Map([
    [config.outputs.fullChinese, fullChinese],
    [config.outputs.fullEnglish, fullEnglish],
    [config.outputs.anchorChinese, anchorChinese],
    [config.outputs.anchorEnglish, anchorEnglish],
    [config.outputs.routerChinese, routerChinese],
    [config.outputs.routerEnglish, routerEnglish],
    [config.outputs.chineseReview, buildChineseReview(config.routes, chineseRules)],
    [config.outputs.map, buildMap(config.routes, englishRules)],
    [config.translationCacheFile, translatedDocument]
  ]);
  for (const route of config.routes.filter((item) => item.skillFile)) {
    const current = await readFile(route.skillFile, "utf8");
    artifacts.set(route.skillFile, replaceSkillRules(current, route.id, englishRules.get(route.id)));
  }
  const outputsCurrent = (await Promise.all([...artifacts].map(([file, content]) => contentEquals(file, content)))).every(Boolean);
  if (!force && state.runtimeSourceSha256 === runtimeSourceSha256 && outputsCurrent) {
    return {
      status: "already-current",
      translated,
      ruleCount,
      contextCharacters,
      routeCounts: Object.fromEntries(config.routes.map((route) => [route.id, englishRules.get(route.id).length]))
    };
  }
  const nextState = `${JSON.stringify({
    version: 1,
    publishedAt: new Date().toISOString(),
    runtimeSourceSha256,
    translationSha256: sha256(translatedDocument),
    ruleCount,
    routeCounts: Object.fromEntries(config.routes.map((route) => [route.id, englishRules.get(route.id).length]))
  }, null, 2)}\n`;
  artifacts.set(config.stateFile, nextState);

  if (dryRun) return { status: "would-publish", translated, ruleCount, contextCharacters, routeCounts: Object.fromEntries(config.routes.map((route) => [route.id, englishRules.get(route.id).length])) };

  const backupRoot = path.dirname(config.outputs.fullEnglish);
  const transaction = await backupAndWrite(artifacts, path.join(backupRoot, "backups"));
  try {
    const validation = await runPostPublish(config);
    return {
      status: "published",
      translated,
      ruleCount,
      contextCharacters,
      routeCounts: Object.fromEntries(config.routes.map((route) => [route.id, englishRules.get(route.id).length])),
      backupDirectory: transaction.backupDirectory,
      validation
    };
  } catch (error) {
    await rollback(transaction.originals);
    throw error;
  }
}

function parseArgs(argv) {
  const options = { configFile: path.join(SCRIPT_DIR, "methodology-targets.json"), force: false, dryRun: false, check: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") options.configFile = argv[++index];
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadConfig(options.configFile);
  const result = await publishMethodology(config, options);
  if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    console.log(result.status === "checked" ? "方法论源和当前发布结果校验通过。" : result.status === "would-publish" ? "预检通过；尚未写入。" : result.status === "already-current" ? "全局方法论已经是最新状态。" : "全局方法论已发布。");
    console.log(`规则总数：${result.ruleCount}`);
    if (result.contextCharacters) console.log(`常驻上下文预算：${result.contextCharacters}/${config.contextLimit} 字符`);
    if (result.routeCounts) for (const [route, count] of Object.entries(result.routeCounts)) console.log(`- ${route}: ${count}`);
    if (result.backupDirectory) console.log(`备份：${result.backupDirectory}`);
    if (result.validation) console.log(result.validation);
  }
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
const modulePath = realpathSync(fileURLToPath(import.meta.url));
const isDirect = process.platform === "win32"
  ? invokedPath.toLowerCase() === modulePath.toLowerCase()
  : invokedPath === modulePath;
if (isDirect) main().catch((error) => { console.error(`发布失败：${error.message}`); process.exitCode = 1; });
