# Windows 全局配置：安装、验证与恢复

## 当前运行方式

Windows 保留现有中文唯一源和忠实英文发布结果。124 条规则的分类不因平台迁移改变，普通消息、启动、恢复、清理、压缩均读取完整常驻英文提醒；不采用 macOS 的每三轮注入。普通最终回答仍以不超过 300 可见字符为验收目标，详细讲解按用户明确要求展开。普通独立工具操作默认尽量 5–8 路，存在依赖、共享可写状态、破坏性操作和审批时按真实边界执行；不默认启用多 Agent。

一个稳定的 `hook-dispatch.mjs` 并行执行提醒、统一 Skill Router 和既有 capability 路由。Windows 图服务使用当前用户私有 ACL 目录保存认证端点，只绑定回环地址，两个常驻 CPU 检索进程复用全库图、模型和查询缓存；不把“两个检索进程”混同于“工具调用只能并发两路”。

用户级、项目级和约 1.55 万外部 Skill 一起筛选。每轮只输出最终最多四个候选的名称、分数和真实文件路径，不输出整个目录的 description 或正文。最近项目同名 Skill 覆盖远处版本；直接点名和明确路由有优先权，其他任务用多语 embedding 语义检索。对相近分数的结果，优先保留本机已有流程；当前 0.30 绝对下限、0.80 相对窗口和 0.85 scoped 比较区间是本项目的待持续校准参数，不是论文证明的通用最优常数。

复用了 macOS 的图持久化和本地 embedding 思路，但没有照搬其 Unix socket、fcntl 锁、自动曝光 22 个 Skill、任务树文件存在即加载、隔轮提醒、默认多 Agent 或 macOS 配置键。旧版 Windows 路由不会在新图服务失败时偷偷顶替；失败会进入 Hook 的错误上下文，要求修复并重跑。

## 安装

已有本机运行时可在仓库根目录运行：

```powershell
node scripts/install-codex-profile-windows.mjs --check --json
```

首次安装先准备原生 CPython 3.11、uv、Node 和完整 Skill 库；不要用 MSYS Python 冒充原生环境。

```powershell
./scripts/deploy-codex-profile-windows.ps1 -LibraryRoot '<完整Skill库>' -RuntimeRoot '<D或E盘的隔离Python目录>'
```

依赖固定在 `codex-profile/windows/requirements.txt`。模型是 `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`；首次部署器会先下载到运行配置指向的 `modelCache`。构图和服务读取本地模型，运行阶段不逐次请求远程 embedding。外部库缺失、依赖缺失或模型不可用时明确失败，不把部分安装当完整恢复。

安装器只更新受管脚本、发布器、方法论、路由与调度器，保留本机登录态、模型配置和其他 Hook。文件有变化才写入，先保存 `~/.codex/backups/portable-profile/<时间戳>/manifest.json`，校验失败自动恢复。安装不等于运行时已经信任 Hook。

## 必须检查真实 Hook 状态

```powershell
node scripts/inspect-codex-hooks.mjs
```

此命令通过当前 Codex 的 `hooks/list` 接口查询真实状态，不从“某处存在 trusted_hash”推断已启用。当前安装后的实测：用户 `SessionStart` 是 `untrusted`，用户 `UserPromptSubmit` 是 `modified`。必须由用户在 Codex 的 `/hooks` 界面确认对应用户 Hook。项目 Hook 是否批准由项目使用需要决定；它不是全局提醒成功的替代品。

不自动写入或复制信任哈希，也不使用 bypass 参数规避审批。审批后还要新开普通任务，确认轨迹出现 Router 推荐后的实际 SKILL.md 读取；只运行脚本、自测通过或完成一个业务修复，不能证明自动注入成功。

## 验证命令

```powershell
node scripts/test-windows-profile.mjs
node scripts/test-parallel-run.mjs
node scripts/benchmark-windows-routing.mjs '<用户目录>/.codex'
node scripts/test-windows-hook-output.mjs
<隔离Python>/Scripts/python.exe scripts/test-windows-worker.py --root '<用户目录>/.codex'
./scripts/test-codex-profile.ps1
./scripts/check.ps1
```

覆盖四候选上限、项目同名覆盖、失效路径拒绝、同数量内容修改、C/D 盘 junction 入口、安装失败回滚、真正的命令执行重叠、共享状态串行、依赖先后、失败回压、认证拒绝、进程复用和八请求压力。路由测试含直接表达、换说法和硬负例；十几条样本不是全任务准确率保证。

本次真实模型测试的订单报表：修复前 7 项中 4 项失败，修复后 7/7 通过，最终回答 241 字，初始工具调用有两路重叠。但轨迹没有 SKILL.md 实际读取证据，且 hooks/list 证实信任未通过，所以不能把这个业务成功说成新 Hook 的自动采用成功。审批后的自动采用和自然 5–8 路工具批次仍待验证。

路由冷启动曾约 47–49 秒，热运行样本约 0.2–0.3 秒。模型等待、Codex 启动数据库检查和工具执行是独立耗时，不能把热路由数字当作全链路加速。服务代码更新、冷缓存和同时启动会影响首轮。图服务由下一次真实请求按需启动，不强加系统登录启动项。

## 更新方法论、索引与恢复

中文源仍由桌面“编辑并发布全局方法论”修改，经原发布器翻译和完整性检查。发布器现在触发 Node 后台刷新；操作系统锁避免同一用户重复重建，SQLite 向量缓存按模型和文本摘要复用。成功后原子替换图，失败保留错误日志，不声称索引已更新。

```powershell
node scripts/snapshot-methodology.mjs
```

该命令只把已发布的中英文方法论与 method Skill 同步回仓库，不复制本机路径、认证值或运行态图。原 `sync-codex-profile.ps1` 在发现 Windows 图运行时时拒绝将 Windows handler 写回共享 Linux 目录；`-Check` 仍可核对安装。

用户和项目 Skill 在当前请求中读取元数据与内容摘要，新建或修改后不必把全部正文提前注入；外部库修改则需更新 `_catalog_cn.json` 并完成后台重建。当前 Windows 图路由只负责 Skill，既有 capability/MCP 路由保留，不宣称已经实现所有远程 HTTP MCP 的自动目录发现。

首份完整旧配置备份位于本机 `.codex/backups/windows-profile/20261018-before-graph`；每次实际安装另有逐文件 manifest 备份。需要撤销时先停止本机图服务，再按选定 manifest 恢复对应文件；后续用户编辑不得被旧备份覆盖。图、SQLite、模型和工作区文件不是同一个回滚对象，不能用 Git 回滚代替恢复用户配置。

运行状态日志：`.codex/skill-registry/worker.log`、`refresh.log`、`build.log`。认证端点只存在 `.codex/skill-registry/private`，不要打印或提交它。仓库只提交源码和测试，运行图应在目标机重建。
