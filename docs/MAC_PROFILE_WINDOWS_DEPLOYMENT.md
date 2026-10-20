# Windows 直接采用 macOS 配置

基线：GitHub `codex/macos-global-deploy` 的 `0cd7d48d90c24a0cf8d0515b8b0dd871fcaac7b2`。

这是采用 macOS 版本，不是继续维护上一版 Windows 方法论。9 份 Prompt 和 22 个全局 Skill 正文与基线逐字节一致；提醒调度脚本也逐字节一致。安装后的规则映射为 76 条，包含 40 条固定提醒。旧的 124 条 Windows 配置已完整备份，不和当前版本混合注入。

## 保持原版的部分

- 固定提醒在同一会话第 1、4、7 等轮出现；动态 Skill/MCP 路由每轮执行。没有稳定会话 ID 时，按原版逻辑每轮保留固定提醒。
- 普通只读工具波次从 2–4 路开始，成功后渐增，失败后减半；20 为上限而不是利用率目标。
- 22 个全局 Skill 安装到用户 `.agents/skills`，不再套用上一版 Windows 的项目优先排序与语义阈值。
- 原版 GraphToolCall 评分、类别预筛、缓存、请求合并和四进程检索池；模型仍为 `sentence-transformers/all-MiniLM-L6-v2`。
- macOS 安装器的实时搜索、Hook、多 Agent、Agent 启用与 20 并发 Agent 上限等非敏感配置合并；已有模型、账号与其他配置保留。

## 必需的 Windows 绑定

macOS 的 Unix socket、fcntl 文件锁、POSIX Python 路径、Node 启动引号和权限位不能直接用于 Windows。适配器处理这些边界，并按后续用户要求增加启动预热；Prompt、提醒节奏、评分和选择算法保持原版：

1. Unix socket 换为仅绑定回环地址的认证连接；端点文件位于用户 ACL 保护目录，认证值不打印、不上传。
2. 文件锁由 portalocker 调用 Windows 锁；保留单实例和进程池，不重写检索算法。
3. Python 改为原生 Windows 虚拟环境路径；模型使用已下载的本地原版缓存，后台任务继承正确路径。
4. Windows 启动引号、隐藏后台窗口和 TOML 路径解析；不加入评分修正。
5. 共享 dispatcher 中仅 Windows 才存在的旧 capability PowerShell 默认路径改为与 macOS 一样的空默认值，避免额外注入上一版推荐器。显式配置仍遵循原版行为。
6. Windows 原生进程池启动时实际初始化并加载四份图，而不只是配置四个最大槽位。四个不同进程完成预热后才发布就绪端点；预热超时明确失败。首次等待端点的期限由 5 秒扩展到原请求已有的 55 秒总期限，不增加逐查询降级路径。

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
```

首次入口需要干净的固定提交工作区、完整 Skill 库、原生 Python 环境和原版 embedding 模型。源文件固化到 `.codex/tools/macos-profile-source`，平台适配结果在 `.codex/tools/macos-profile-native`。对应关系和备份位置保存在本机 `.codex/skill-registry/mac-source.json`。原始 Git 源与适配结果分开保存，避免改写 Prompt 或评分后仍称“原版”。

首次备份在本机 `.codex/backups/mac-direct/20261019T080253Z`；原生 macOS 安装事务另有逐文件 manifest。备份包含机器配置，应只在本机受保护目录恢复，不能提交到仓库。先核对目标与后续用户修改，再恢复选定版本；不要整体覆盖用户目录。

## 已验证与尚未验证

已通过：9 份 Prompt、22 个 Skill 的字节一致性，原版提醒/调度脚本一致性，四轮固定提醒与每轮动态路由、原版 DAG 调度的真实重叠/依赖/回压测试，以及仓库本地门禁。任务树 MCP 已注册并真实发现 18 个工具。

自然任务测试没有要求使用 Skill：模型自动读取了 `systematic-debugging` 与 `method-engineering-execution`，按契约检查统计实现并运行现有测试，复现三条商品明细被误算为三笔订单而不是两笔。证据在本机 `.reports/mac-live-events.jsonl` 与 `.reports/mac-live-final.txt`。这是实际技能采用证据，不等于 Hook 信任已通过。

原版全量图更新需要真实构图，不能把 MCP 目录里的工具数当作图中工具数；`test-mac-routed-tool.mjs` 要求正式 Router 推荐 `task_tree_focus` 后，实际执行只读调用并收到结果。若该门禁失败，不得报告已经完成该闭环。

本机最终清单已确认 15,471 个外部 Skill、24 个用户 Skill（22 个基线 Skill 加原有两个）和 31 个 MCP 工具；目录另有 1 条缺失文件，按原版缺失计数记录，未冒充可用文件。正式 Router 推荐任务树焦点工具后，真实调用已返回结果。热态四轮回归无检索错误；首次新图重载曾出现 55 秒超时，失败结果保存在本机 `.reports/mac-parity-first-with-timeout.json`，不能用后续热态成功抹去冷态限制。

普通新会话的 Hook 自动执行仍需用户确认信任；安装器不会写入信任哈希或使用 bypass 参数。尚未证明三轮提醒的长期保持质量、跨机器重启恢复、任意中文任务的最优路由或模型端到端提速。恢复、信任和图更新状态必须分别验证。

## 2026-10-20：修复“容量四个，却只加载一个”

此前 Windows 与原版 macOS 都配置四个进程容量，但原生进程池可按需创建；“参数为四”不是“四份图均已加载”的证据。本次按用户要求增加显式预热，检索算法不改。真实健康回执报告四个不同 PID，各加载图一次；八个带唯一标识、避免结果缓存的检索请求区间重叠，并实际由这四个进程处理。样本约 2.65–3.49 秒，不能与缓存命中的约 3 毫秒混为一谈，也不是模型端到端耗时。

`--check` 现在还要求认证状态接口确认四个已预热进程存在；预热命令会启动缺失服务，单纯只读检查不会偷偷把缺失服务说成已驻留。证据为本机 `.reports/mac-worker-residency.json`。

本轮五个已知独立工具调用通过同一个 `functions.exec` 的 `Promise.all` 同时提交，时间区间重叠；界面一张封装工具卡并不等于一条内部操作。该波工具调用证据位于本机 `.reports/parallel-tool-wave-20261020.json`。存在真实依赖、先读必要 Skill 或需要用户确认的步骤仍应串行；不能为凑数量虚构任务。

9 份用户 Prompt、22 个 Skill 及提醒脚本仍逐字节一致。当前 `hooks/list` 却显示用户 SessionStart 为 untrusted、UserPromptSubmit 为 modified：文件相同与实际注入相同不是同一个验收。用户需要在 Codex 的 `/hooks` 中确认这两个用户 Hook，之后才能测自然任务的自动调度遵守率。平台系统指令、Windows/Mac 工具定义与操作系统环境不属于这些可复制 Prompt 文件；本实现不能保证整个模型输入逐字相同。

### 本轮任务树实际写回

- ROOT / CurrentResult：Windows 采用 macOS 原版：9 份 Prompt、22 个 Skill 一致，76 条规则及第 1、4 轮提醒、每轮路由测试通过。普通任务自动读取 Skill，正式 Router 推荐后实际调用任务树工具成功，31 个 MCP 已入图。Hook 信任待用户确认，冷启动曾 55 秒超时；尚不能宣称所有普通会话自动注入或稳定低延迟。 → 9 份 Prompt 与22个 Skill 仍与 macOS 基线逐字一致。Windows 已改为4个进程启动时加载图并常驻，8个未缓存请求实测由4个进程处理；本轮还实际并发提交5个工具调用。两个用户 Hook 仍未获信任，自动提醒注入尚未完成验收，不能宣称所有会话都会按并发规则执行。
- ROOT / RootCauseAnalysis：Windows 的路径、文件锁和进程通信必须适配，当前保留 macOS 原文与评分，仅替换平台绑定。原版新图重载曾触发 55 秒超时，热态闭环成功不代表冷态延迟已解决。 → 此前把四进程容量当作四个已加载进程，且把文件一致误当作运行时注入一致。现已验证4个进程预热，剩余注入断点是用户 Hook 的未信任或已修改状态，不应通过重复改写 Prompt 掩盖。
- ROOT / NextIdea：用户确认两个用户级 Hook 后，复测普通会话自动注入及三轮提醒；保持原版评分和 Prompt 不变。 → 用户在 Codex 中确认 SessionStart 与 UserPromptSubmit 两个用户 Hook 后，复测普通任务的实际注入和独立工具批次；保留原版 Prompt 与评分。

## 任务树写回回执

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
