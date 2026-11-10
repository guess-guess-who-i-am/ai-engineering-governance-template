# IDE v12 与现有全局 worker 兼容性复核

2026-10-18 15:56–15:58（北京时间），仅核对外部 Skill 精确读取和隔离根目录两项修复。没有修改 IDE/Kit 文件、全局 Hook/图文件或5505任务；没有停止/重启1074、661、687。探针使用 IDE 自带 Node v22.23.2，新版socket及独立临时目录。

## 结论

两项正常功能兼容性通过，共21项断言：

- 两个不同候选目录共用新版broker PID 14829，socket为 `task-tree-agent-501/7ab548051411dc9fddd1.sock`，版本标识为 `runtime-v12-external-skills-isolated-root`；旧661继续存在，5505的1074和全局图687的启动时间没有改变。
- 两路全局UserPromptSubmit分别105/104毫秒，总墙钟106毫秒，均有真实路由候选且无警告。这里使用已预热的短查询，不代表冷启动、未缓存长输入或100路成绩。
- 全局图仍复用PID 687，queryPid 697、loads=1、prefilter=true，不因IDE broker版本变化重复启动图服务。全局socket的路径只依赖用户与图的绝对路径，不依赖候选cwd。
- 两个会话按路由精确路径读取同一外部Skill，各返回完整4122字节，SHA-256均为 `7e38bae10d0df33400530075c9b0d2037f97bcbf7c8532bacc3e373a55a74e34`，与直接读取文件一致。耗时1/0毫秒，原先“Skill not installed”不再出现。
- 启动仍只有39个入口Skill，system提示20487字节；空查询不返回外部全库。名称发现命中目标Skill，分别65/52毫秒。此耗时包含过滤匹配，不应当作是否重复解析JSON的精确测量。
- 故意把TASK_TREE_PROJECT_ROOT设置为另一个owner目录后，两个候选的shell、项目Hook、实际task_tree_focus MCP仍各自返回自己的根目录；owner单独保留。不同候选没有串到宿主或对方的树。
- 两个会话均拒绝库外路径、目录前缀伪装和非SKILL.md直接路径。

代码边界也一致：全局 `external-skills-manifest.json` 提供正确schemaVersion、rootPath和catalogPath；新读取器的readExact仅需小manifest，名称发现才使用catalog缓存。临时夹具中故意不创建catalog，合法精确路径仍成功读取，证实该路径不依赖全量目录加载。

## 仍需IDE侧处理的严格安全边界

临时假数据夹具另测到一个遗漏，不影响上面的正常功能兼容性，但不能据此宣称完整安全门禁：

1. 库内 `escape/SKILL.md` 链接到库外普通文件：正确拒绝。
2. 库内 `alias/SKILL.md` 链接到同一库内的 `notes.txt`：仍成功读取假数据。

首次偏离位于 `server/external-skill-catalog.js` 的readExact：只检查请求路径basename，在realpath之后只检查是否仍在root内，没有再次限定解析后basename及普通文件类型。若契约要求“仅真实SKILL.md”，应在IDE侧补充这两项校验和回归；不要修改全局库，也不需要重建图。普通文件校验还可避免特殊文件导致读取阻塞，本次没有创建或读取特殊文件。

本聊天未替IDE修改。若后续修复该读取器，已存在的v12 broker仍持有旧模块；应按IDE方的版本socket策略发布新会话，不能杀旧661来让补丁生效。别把本报告误认为旧生产长任务已热切换到v12。

原有“所有调用必须经过路由”的强制门禁、4个桌面专属node_repl工具、另机重启和三轮提醒长期质量不在这两项修复的验收范围，不因本次通过而自动解决。

## 证据与复现

- 可复用脚本：`scripts/check-ide-global-compatibility.mjs`，唯一参数为IDE绝对目录；仅允许源码中声明v12的broker，写夹具到mkdtemp目录。
- 正式原始报告：`.reports/ide-global-compatibility-v12-20261018.json`，21/21断言通过，未保存用户提示、Hook全文、Skill正文或凭据。
- 正常探针目录：`/var/folders/q1/fjylgh7x6cx04ljtdp550ls40000gn/T/global-v12-compatibility-eSwzny`。
- 安全边界夹具与报告：`/var/folders/q1/fjylgh7x6cx04ljtdp550ls40000gn/T/external-catalog-edge-DOGDaM/report.json`，只含VALID_SKILL_FIXTURE和BENIGN假数据。
- 安全边界报告也保存到 `.reports/ide-external-skill-edge-v12-20261018.json`，避免临时目录清理后丢失观测。
- 初次探针把macOS的 `/var` 与 `/private/var` 当作不同目录，出现路径比较误报；改用realpath比较shell的cwd后21项通过。TASK_TREE_PROJECT_ROOT和owner仍分别校验原值，未通过放宽到任意目录来掩盖错误。
- Node语法、缺少IDE参数时的拒绝启动检查及 `git diff --check` 通过；任务树精炼通过，执行流程检查不适用。生产旧进程启动时间核对通过；不执行新模型任务、不重跑100路负载，不干扰仍在运行的生产任务。
