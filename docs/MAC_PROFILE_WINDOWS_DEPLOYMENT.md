# Windows 直接采用 macOS 配置

基线：GitHub `codex/macos-global-deploy` 的 `0cd7d48d90c24a0cf8d0515b8b0dd871fcaac7b2`。

当前是此不可变基线加 `routing-repair-v3-20261020` 策略修复。9份Prompt和22个Skill按声明的有效源校验，不再冒称与旧提交全部逐字相同；76条规则、40条固定提醒均保留，其中并发句仅移除冲突的旧数值，其余原句保留，完整旧句另存审阅区。旧124条Windows配置不混入。当前证据和限制以 [修复报告](ROUTING_AND_EXECUTION_REPAIR.md) 为准；下方旧回执为历史，不是现状。

## 保留的行为与明确批准的修复

- 固定提醒在同一会话第 1、4、7 等轮出现；动态 Skill/MCP 路由每轮执行。没有稳定会话 ID 时，按原版逻辑每轮保留固定提醒。
- 普通只读波次从可执行独立任务数与4的较小值开始，成功后渐增，失败后减半；20为上限而不是利用率目标。优先原生批量，Shell-only宿主可通过标准输入使用Node执行器。
- 22 个全局 Skill 安装到用户 `.agents/skills`，不再套用上一版 Windows 的项目优先排序与语义阈值。
- 保留GraphToolCall图、类别预筛、缓存、请求合并和四进程池；改用固定revision的多语MiniLM-L12，并对独立召回通道做排名融合，不再给MCP固定加分或屏蔽已有别名的图候选。
- macOS 安装器的实时搜索、Hook、多 Agent、Agent 启用与 20 并发 Agent 上限等非敏感配置合并；已有模型、账号与其他配置保留。

## 必需的 Windows 绑定

macOS 的 Unix socket、fcntl 文件锁、POSIX Python 路径、Node 启动引号和权限位不能直接用于 Windows。绑定差异与上面的共享策略变更分别记录，不能混称全都原样不动：

1. Unix socket 换为仅绑定回环地址的认证连接；端点文件位于用户 ACL 保护目录，认证值不打印、不上传。
2. 文件锁由 portalocker 调用 Windows 锁；保留单实例和进程池，不重写检索算法。
3. Python 改为原生 Windows 虚拟环境路径；模型使用已下载的本地原版缓存，后台任务继承正确路径。
4. Windows 启动引号、隐藏后台窗口和 TOML 路径解析；不加入评分修正。
5. 共享 dispatcher 中仅 Windows 才存在的旧 capability PowerShell 默认路径改为与 macOS 一样的空默认值，避免额外注入上一版推荐器。显式配置仍遵循原版行为。
6. Windows 原生进程池启动时实际初始化并加载四份图，而不只是配置四个最大槽位。四个不同进程完成预热后才发布就绪端点；预热超时明确失败。首次等待端点的期限由 5 秒扩展到原请求已有的 55 秒总期限，不增加逐查询降级路径。
7. Codex 实际通过 PowerShell 执行 Hook 命令，带引号的可执行路径前必须加调用符 `&`；参数用单引号保护，并将路径内部的单引号加倍。回归覆盖 Windows PowerShell 与 PowerShell 7、中文、空格、单引号及其他 Shell 特殊字符；不能用直接启动 Node 的成功替代这个边界测试。

Finder 快速操作是 macOS 系统功能，不能原样运行在 Windows；本机使用可重用的原生部署入口，不能把 Finder 服务宣称为已在 Windows 安装。

## 本机使用

```powershell
git worktree add --detach .reports/upstream-macos-0cd7d48 0cd7d48d90c24a0cf8d0515b8b0dd871fcaac7b2
node scripts/install-mac-profile-on-windows.mjs --source .reports/upstream-macos-0cd7d48 --library E:/skills
node scripts/install-mac-profile-on-windows.mjs --check
node scripts/prewarm-mac-worker.mjs
node scripts/test-mac-worker-residency.mjs
node scripts/test-mac-profile-on-windows.mjs
node scripts/test-mac-routed-tool.mjs
node scripts/test-mac-windows-hook-command.mjs
```

首次入口需要干净的固定提交工作区、完整 Skill 库、原生 Python 环境和原版 embedding 模型。源文件固化到 `.codex/tools/macos-profile-source`，平台适配结果在 `.codex/tools/macos-profile-native`。对应关系和备份位置保存在本机 `.codex/skill-registry/mac-source.json`。原始 Git 源与适配结果分开保存，避免改写 Prompt 或评分后仍称“原版”。

首次备份在本机 `.codex/backups/mac-direct/20261019T080253Z`；原生 macOS 安装事务另有逐文件 manifest。备份包含机器配置，应只在本机受保护目录恢复，不能提交到仓库。先核对目标与后续用户修改，再恢复选定版本；不要整体覆盖用户目录。

## 切换初期的验证记录（历史）

已通过：9 份 Prompt、22 个 Skill 的字节一致性，原版提醒/调度脚本一致性，四轮固定提醒与每轮动态路由、原版 DAG 调度的真实重叠/依赖/回压测试，以及仓库本地门禁。任务树 MCP 已注册并真实发现 18 个工具。

自然任务测试没有要求使用 Skill：模型自动读取了 `systematic-debugging` 与 `method-engineering-execution`，按契约检查统计实现并运行现有测试，复现三条商品明细被误算为三笔订单而不是两笔。证据在本机 `.reports/mac-live-events.jsonl` 与 `.reports/mac-live-final.txt`。这是实际技能采用证据，不等于 Hook 信任已通过。

原版全量图更新需要真实构图，不能把 MCP 目录里的工具数当作图中工具数；`test-mac-routed-tool.mjs` 要求正式 Router 推荐 `task_tree_focus` 后，实际执行只读调用并收到结果。若该门禁失败，不得报告已经完成该闭环。

本机最终清单已确认 15,471 个外部 Skill、24 个用户 Skill（22 个基线 Skill 加原有两个）和 31 个 MCP 工具；目录另有 1 条缺失文件，按原版缺失计数记录，未冒充可用文件。正式 Router 推荐任务树焦点工具后，真实调用已返回结果。热态四轮回归无检索错误；首次新图重载曾出现 55 秒超时，失败结果保存在本机 `.reports/mac-parity-first-with-timeout.json`，不能用后续热态成功抹去冷态限制。

每台机器的 Hook 信任独立保存；安装器不会写入信任哈希或使用 bypass 参数。2026-10-20 本机用户明确委托代办后，已通过正式 CLI 审查界面逐个批准两个用户 Hook，且新会话已收到真实上下文。项目 Hook 未同时批准。尚未证明三轮提醒的长期保持质量、跨机器重启恢复、任意中文任务的最优路由或模型端到端提速。恢复、信任、实际启动和图更新状态必须分别验证。

## 2026-10-20：修复“容量四个，却只加载一个”

此前 Windows 与原版 macOS 都配置四个进程容量，但原生进程池可按需创建；“参数为四”不是“四份图均已加载”的证据。本次按用户要求增加显式预热，检索算法不改。真实健康回执报告四个不同 PID，各加载图一次；八个带唯一标识、避免结果缓存的检索请求区间重叠，并实际由这四个进程处理。样本约 2.65–3.49 秒，不能与缓存命中的约 3 毫秒混为一谈，也不是模型端到端耗时。

`--check` 现在还要求认证状态接口确认四个已预热进程存在；预热命令会启动缺失服务，单纯只读检查不会偷偷把缺失服务说成已驻留。证据为本机 `.reports/mac-worker-residency.json`。

本轮五个已知独立工具调用通过同一个 `functions.exec` 的 `Promise.all` 同时提交，时间区间重叠；界面一张封装工具卡并不等于一条内部操作。该波工具调用证据位于本机 `.reports/parallel-tool-wave-20261020.json`。存在真实依赖、先读必要 Skill 或需要用户确认的步骤仍应串行；不能为凑数量虚构任务。

9 份用户 Prompt、22 个 Skill 及提醒脚本仍逐字节一致。首次 `hooks/list` 显示用户 SessionStart 为 untrusted、UserPromptSubmit 为 modified；后续已正式批准并修复 PowerShell 启动边界，详见下一节。文件相同、已信任、实际注入和模型采用必须分别验收。平台系统指令、Windows/Mac 工具定义与操作系统环境不属于这些可复制 Prompt 文件；本实现不能保证整个模型输入逐字相同。

## 2026-10-20：委托批准与真实启动验收

本机用户明确授权代办后，使用 Codex CLI 的 Review hooks 界面，按事件和来源核对后，分别批准用户 SessionStart 与 UserPromptSubmit。未选择 Trust all，未使用 bypass，未手工生成或写入信任哈希，未批准项目的 UserPromptSubmit/Stop。批准前的本机配置备份在 `.codex/backups/hook-trust-delegated/20261020-before-review`；不上传此备份或信任记录。

第一次真实新会话揭示两层问题：批准成功后，两个 Hook 仍返回退出码 1。复现证明旧命令把双引号路径直接交给 PowerShell，缺少调用符而触发解析错误；先前安装测试直接启动 Node，绕过了真正失败的命令层。现已修复 Windows 安装适配器，重新安装仅改变 hooks.json，并通过同一正式界面重新批准已变更的两个用户 Hook。新启动命令为 `& 'Node绝对路径' 'dispatcher绝对路径'`。本轮安装回滚备份为 `.codex/backups/portable-profile/20261020T043234Z`。

回归先对旧实现失败，再对新实现通过；Windows CI 已加入命令层测试，并明确检查每条测试命令的退出码。9 份 Prompt、22 个 Skill、第 1/4 轮固定提醒及每轮路由仍通过原文与节奏验证。四个常驻检索进程的八个唯一未缓存请求实际重叠，约 1.1–3.1 秒；这不是模型端到端时间。

真实任务未提示并发、精简或使用 Skill，只要求检查订单统计偏大并用现有测试验证。新会话两个用户 Hook 均 completed，分别约 1.50/1.58 秒；上下文确有 `GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3`、`ADAPTIVE_TOOL_SCHEDULING_CONTRACT_V4` 和 `CODEX_SKILL_ROUTER_V2` 三个标记。模型自动读取调试与工程 Skill，准确复现问题，最终回答 236 字；该样本端到端约 109 秒，8 次外层命令执行仍没有时间重叠，不能宣称模型自动高并发已达成。

可复用脚本再跑同一自然任务也通过：两个 Hook 约 0.55/0.72 秒，三个标记齐全，回答 259 字，端到端约 101 秒；4 次外层命令的最大重叠仍为 1。最新证据文件对应这次复测，不把更快的 Hook 耗时当成模型端到端速度。

可复用实际入口测试如下，仅对专用的只读测试项目执行；会调用真实模型并产生调用费用。脚本不修改 Hook 信任，不自动批准任何新 Hook。它记录注入标记、Hook 生命周期、命令时间、实际重叠及回答字数；退出成功只表示 Hook 注入与自然任务完成，不代表已达到指定并发数或回答字数。

```powershell
node scripts/test-codex-hook-runtime.mjs --cwd <只读测试项目路径> --prompt "检查这个项目的订单统计问题，用已有测试验证判断；不修改文件。"
```

本机证据为 `.reports/trusted-hook-live-result.json` 和 `.reports/trusted-hook-live-events.jsonl`；修复前的失败保存在 `.reports/trusted-hook-before-command-fix.json` 及配套事件文件。原始本机日志不上传。外层命令区间只衡量外层命令重叠，不推断内部脚本或模型服务的并行度。

### 历史任务树写回（批准前的实际回执，不是当前状态）

- ROOT / CurrentResult：Windows 采用 macOS 原版：9 份 Prompt、22 个 Skill 一致，76 条规则及第 1、4 轮提醒、每轮路由测试通过。普通任务自动读取 Skill，正式 Router 推荐后实际调用任务树工具成功，31 个 MCP 已入图。Hook 信任待用户确认，冷启动曾 55 秒超时；尚不能宣称所有普通会话自动注入或稳定低延迟。 → 9 份 Prompt 与22个 Skill 仍与 macOS 基线逐字一致。Windows 已改为4个进程启动时加载图并常驻，8个未缓存请求实测由4个进程处理；本轮还实际并发提交5个工具调用。两个用户 Hook 仍未获信任，自动提醒注入尚未完成验收，不能宣称所有会话都会按并发规则执行。
- ROOT / RootCauseAnalysis：Windows 的路径、文件锁和进程通信必须适配，当前保留 macOS 原文与评分，仅替换平台绑定。原版新图重载曾触发 55 秒超时，热态闭环成功不代表冷态延迟已解决。 → 此前把四进程容量当作四个已加载进程，且把文件一致误当作运行时注入一致。现已验证4个进程预热，剩余注入断点是用户 Hook 的未信任或已修改状态，不应通过重复改写 Prompt 掩盖。
- ROOT / NextIdea：用户确认两个用户级 Hook 后，复测普通会话自动注入及三轮提醒；保持原版评分和 Prompt 不变。 → 用户在 Codex 中确认 SessionStart 与 UserPromptSubmit 两个用户 Hook 后，复测普通任务的实际注入和独立工具批次；保留原版 Prompt 与评分。

## 历史任务树写回回执

以下为本次服务端实际落盘的字段变化，未改动 GraphState 焦点，也未新建执行流程：

- ROOT / Completion：已完成 → 进行中。
- ROOT / Notes：只支持 macOS；20 是硬上限，不是首波目标。全局 Skill/MCP 经过 GraphToolCall。另一台 Mac 的重启恢复尚未实测，远程 HTTP MCP 目录发现尚未接入。 → 最新要求是在 Windows 直接采用 GitHub 的 macOS 版本；跨机重启与三轮提醒的长期保持效果仍未验证。
- ROOT / CurrentResult：macOS全局检索已部署4个常驻进程，仓库与安装文件一致；独立复核100个不同长请求的完整Hook突发、错峰及冷启动均100/100成功，P95约28.9、25.2、40.8秒。11项worker回归通过；100请求可用，但低延迟、三轮提醒长期质量和跨Mac重启仍有验证或优化缺口。 → Windows 已采用同一 macOS 基线：9 份 Prompt、22 个 Skill 原文一致，四轮测试在第 1、4 轮注入固定提醒且每轮路由；18 个任务树工具已可实际调用。新发现的 MCP 工具尚未完成入图，Hook 信任待确认，因此尚不能宣称普通新会话自动全链路可用。
- ROOT / RootCauseAnalysis：原单连接、大锁和Hook重复扫描外部全库导致排队；embedding重排绕过缓存和互斥，Metal并发会崩溃。现用4进程池、图版本缓存、在途请求合并及CPU模型缓存，并删去每轮重复外部注册表。 → Windows 的路径、文件锁和进程通信不能直接执行 macOS 实现，当前仅适配平台绑定，不改原文与评分。MCP 目录发现不等于图更新成功，必须核对新图与真实调用。
- ROOT / NextIdea：持续监测真实长任务和完成检查的检索延迟、失败率与缓存命中，并在另一台Mac验证重启恢复和三轮提醒质量。 → 完成原版模型的 MCP 入图并验证推荐到实际调用闭环，待用户确认 Hook 信任后再测普通新会话自动使用。
- ROOT / CurrentResult 后续写回：Windows 已采用同一 macOS 基线：9 份 Prompt、22 个 Skill 原文一致，四轮测试在第 1、4 轮注入固定提醒且每轮路由；18 个任务树工具已可实际调用。新发现的 MCP 工具尚未完成入图，Hook 信任待确认，因此尚不能宣称普通新会话自动全链路可用。 → Windows 已采用同一 macOS 基线，9 份 Prompt、22 个 Skill 原文一致，四轮验证第 1、4 轮固定提醒且每轮路由。普通只读任务已自动读取调试与工程 Skill 并复现错误。MCP 新目录入图及 Hook 信任仍未通过，尚不能宣称全链路自动可用。
- ROOT / CurrentResult 最后写回：Windows 已采用同一 macOS 基线，9 份 Prompt、22 个 Skill 原文一致，四轮验证第 1、4 轮固定提醒且每轮路由。普通只读任务已自动读取调试与工程 Skill 并复现错误。MCP 新目录入图及 Hook 信任仍未通过，尚不能宣称全链路自动可用。 → Windows 采用 macOS 原版：9 份 Prompt、22 个 Skill 一致，76 条规则及第 1、4 轮提醒、每轮路由测试通过。普通任务自动读取 Skill，正式 Router 推荐后实际调用任务树工具成功，31 个 MCP 已入图。Hook 信任待用户确认，冷启动曾 55 秒超时；尚不能宣称所有普通会话自动注入或稳定低延迟。
- ROOT / RootCauseAnalysis 最后写回：Windows 的路径、文件锁和进程通信不能直接执行 macOS 实现，当前仅适配平台绑定，不改原文与评分。MCP 目录发现不等于图更新成功，必须核对新图与真实调用。 → Windows 的路径、文件锁和进程通信必须适配，当前保留 macOS 原文与评分，仅替换平台绑定。原版新图重载曾触发 55 秒超时，热态闭环成功不代表冷态延迟已解决。
- ROOT / NextIdea 最后写回：完成原版模型的 MCP 入图并验证推荐到实际调用闭环，待用户确认 Hook 信任后再测普通新会话自动使用。 → 用户确认两个用户级 Hook 后，复测普通会话自动注入及三轮提醒；保持原版评分和 Prompt 不变。

## 2026-10-20 本次任务树实际回执

以下仅据本轮服务端 `changes` 生成，焦点和执行流程未改：

- ROOT / CurrentResult：9 份 Prompt 与22个 Skill 仍与 macOS 基线逐字一致。Windows 已改为4个进程启动时加载图并常驻，8个未缓存请求实测由4个进程处理；本轮还实际并发提交5个工具调用。两个用户 Hook 仍未获信任，自动提醒注入尚未完成验收，不能宣称所有会话都会按并发规则执行。 → 9份Prompt与22个Skill仍与macOS基线一致，4个预热检索进程通过8个未缓存请求验证。用户授权后已通过正式界面批准两个用户Hook，并修复Windows启动命令；新会话实际注入三个标记，普通任务回答236字。该任务8次命令仍串行，模型自动并发及长期跨机会话效果不能宣称完成。
- ROOT / RootCauseAnalysis：此前把四进程容量当作四个已加载进程，且把文件一致误当作运行时注入一致。现已验证4个进程预热，剩余注入断点是用户 Hook 的未信任或已修改状态，不应通过重复改写 Prompt 掩盖。 → 此前直接运行脚本绕过了Codex实际使用的PowerShell命令层，未发现引号路径缺少调用符，信任通过后仍启动失败。已补真实命令回归并修复安装器；注入成功不等于模型必然采用并发。
- ROOT / NextIdea：用户在 Codex 中确认 SessionStart 与 UserPromptSubmit 两个用户 Hook 后，复测普通任务的实际注入和独立工具批次；保留原版 Prompt 与评分。 → 保持macOS原版Prompt和评分，用确有独立分支的普通任务测量模型工具重叠，定位自动并发仍串行的边界。
