# AI Engineering Governance Template

把本机这套全局 Codex 提示词、Skills、GraphToolCall 检索、Hook 和并行调度搬到其他电脑。三平台共用同一个模板源，安装过程由程序完成，不需要多个 Agent，也不需要用户输入安装代码。

更新：2026-10-25。中文检索、双语预热、并发调度及 Hook cadence 已纳入此私有部署分支。推荐根据任务内容触发，不要求用户点名 Skill 或 MCP；真实对话 Hook 信任仍需 Codex 客户端批准，未批准的 Hook 不会运行。检索边界见[任务内容自动推荐](docs/TASK_CONTENT_RECOMMENDATIONS.md)和[检索运行时实测](docs/RETRIEVAL_RUNTIME_UPGRADE.md)。

2026-10-24 完整模块接入：447 个专家、3,307 个 Skill 版本及 478 个 MCP 服务已安装到本机全局，并合入 19,753 节点的辅助路由图；原始专家不拆分。接入范围、已知失败和召回限制见 [完整模块记录](docs/RESOURCE_MODULES.md)。这些本地新增资源不包含在尚未更新的下载包中，不能将入图等同于全部功能已验证。

2026-10-25 专家调用简化：本机已改为一次读取入口就加载完整原始主角色，不拆改原包、不做工具映射。446 个专家有明确主角色，1 个入口歧义明确受阻；加载成功不等于业务执行成功。见[使用方式和实测边界](docs/EXPERT_DIRECT_ENTRY.md)。

## 最简单的安装方式

在 GitHub 登录有权限的账号后，打开私有仓库 `guess-guess-who-i-am/ai-engineering-governance-template`，下载 `codex/macos-global-deploy` 分支 ZIP，**先解压整个文件夹**，再打开对应文件：

| 电脑系统 | 双击哪个文件 | 常驻服务 |
| --- | --- | --- |
| macOS | **安装全局配置-macOS.command**；旧的“安装全局配置.command”也可用 | 登录后由 LaunchAgent 自动启动 |
| Windows | **安装全局配置-Windows.cmd** | 登录后由计划任务自动启动 |
| Linux 桌面 | **安装全局配置-Linux.desktop**，选择“运行/允许启动” | systemd 用户服务；启用 linger 后开机未登录也启动 |

首次按系统提示授权即可，不必手输命令。已安装过：下载新版本、解压、再次双击同一入口，自动备份后更新。配置是**用户全局的**，装一次就供所有现有和未来工作区使用，不需要在每个仓库安装，也不会自动创建一堆 Agent。

新电脑需要先通过图形安装器准备 **Codex、Git、Python 3.10+（含 pip/venv）**；没有可用的 Codex 内置 Node 时再安装 **Node.js 20+ LTS**。这不是包含操作系统和所有基础软件的离线安装包。安装器自动建立隔离 Python 环境、安装锁定的检索依赖、恢复 Skill 库并建图。缺少依赖会给出下载地址，不会假报成功。

模板、15k+ 第三方 Skill 镜像和资源包均位于私有 GitHub 仓库。目标 GitHub 账号需要分别获得模板仓库与 [skills-library](https://github.com/guess-guess-who-i-am/skills-library) 的读取权限；专家/Skill/MCP 完整模块归档通过该私有资源仓库的 Release 分发。可用 GitHub Desktop 登录或安装 [GitHub CLI](https://cli.github.com/) 后按浏览器授权；不复制另一台电脑的 token、登录态或本机图索引。只获取模板 ZIP 而没有私有资源权限，不能恢复全量资源。

完整的点击步骤、首次授权、更新与故障处理见 **[三平台傻瓜式安装说明](docs/INSTALLATION.md)**。

> 当前安装器在 `codex/macos-global-deploy` 分支，`main` 合并前请勿把旧版入口当作同一版本。代码通过 [PR #26](https://github.com/guess-guess-who-i-am/ai-engineering-governance-template/pull/26) 交付。原生平台的验证范围见 [安装验收记录](docs/PORTABLE_PROFILE_VERIFICATION.md)。

## 和本机统一哪些内容

- 全局 AGENTS 入口、中文唯一编辑源、英文运行提示、路由与发布器，同源生成；目前校验 76 条规则。
- 22 个仓库自有 Skill 安装到用户级全局目录；第三方完整库安装到全局工具目录。自有 Skill、第三方 Skill 与已发现 MCP 工具合并到同一张 GraphToolCall 图，按目标电脑实际路径重建，不携带本机绝对路径。
- GraphToolCall 0.46.0、sentence-transformers 6.1.0；英文查询保留 all-MiniLM-L6-v2，含中文查询使用 paraphrase-multilingual-MiniLM-L12-v2、中文分词和受约束候选池。中文说明与向量提前建好，请求时不调用翻译服务；首次安装需下载两个模型。常驻进程复用索引，Linux 使用 CPU-only PyTorch，不复制 Mac 虚拟环境。
- 每个查询进程在服务启动及换图时完成中英文模型、BM25 和候选池的初始化，再接受正常检索；不是只发英文预热请求。检索与重排用的静态描述向量均提前构建并保存，新问题的查询向量现场计算，重复查询复用缓存。
- 源码导航恢复 `rg` 和按需局部读取；安装器直接删除本配置曾安装的 Serena 配置块、导航 Skill、路由及专属运行文件，不保留该失败接入的备份。实验报告保留，用户自有数据和其他 MCP 配置不受影响。当前行为和证据见[双语预热与 Serena 撤回](docs/PREWARM_AND_SERENA_ROLLBACK.md)。
- V5 调度：安全且独立的就绪任务通常一次发出 5–8 路，确定性 DAG 执行器默认 8 路；依赖、危险、共享状态及限流操作受约束。20 是 Agent 硬上限，不是每次任务必须开 20 个 Agent。
- 固定 Hook 内容每三轮注入一次，动态 Skill 路由每轮执行；提示词改变后下一请求立即刷新，压缩与恢复时补回调度契约。
- 按目标电脑 CPU 和内存选择 1–8 个常驻查询进程，128 个在途请求和 256 个等待连接，不在每次检索时重新加载全图。安装后执行预热与完整性检查。
- 自动备份被覆盖的受管文件；保留原模型、provider、用户自有配置、其他 Hook 及非受管 Skills。重复安装不复制同名入口。

**不会统一或上传**：API Key、token、cookie、auth.json、Codex/GitHub 登录态、机器本地备份、模型 provider 的私密配置。每台电脑使用自己的账号和权限；不伪造 Hook 信任、不放宽企业安全策略。首次需在 Codex 内批准受管 Hook；静态工具列表变化时，可能需要新建对话或重启客户端。

“和本机同源”不等于任何电脑都能达到相同耗时。194 实测已证实真实 8 路并行与 100/100 请求成功，但整体对话仍存在约 20–158 秒长尾；不能把并发配置上限当作稳定提速证明。详见 [194 提示词统一实测](docs/SERVER_194_PROMPT_UNIFICATION.md)。

## 装好之后怎么用

直接在任意工作区打开 Codex，正常提问即可。Skills 和 MCP 的候选推荐由全局路由处理，不需要逐个启用或粘贴全文。

Mac 首次安装还会添加“部署 Codex 全局配置”Finder 快速操作，后续可从工作区文件夹的右键菜单进入；部分 macOS 将其放在“快速操作/服务”子菜单，不能承诺在所有应用的顶层右键菜单出现。

更新 Skill 或 MCP 后，下一次 SessionStart 会在后台检查索引输入是否变化，保留旧图直到新图构建成功；不是每条请求都重建。新库或模型首次下载/建图需要网络和时间，初次安装速度不代表热态检索速度。

## 可维护的工程治理模板

本仓库也可作为下游项目的工程起点：

- AGENTS.md：最小常驻导航、权威顺序和验证预算。
- CONTEXT.md / DESIGN.md：领域语义与视觉系统。
- codex-profile/global-skills：自有 Skill 的唯一版本源，不从项目目录自动发现。
- scripts / quality / requirements：确定性门禁、用户故事、证据和问题生命周期。
- .kest/flow / qualitative：可执行 Flow 与校准后的定性门禁。
- UPSTREAMS.md / upstreams.lock.json：第三方来源、许可证和固定版本；完整上游镜像不放进公开模板仓库。

创建独立产品可在 Codex 中调用 start-new-project；不会替用户擅自发布仓库。下游项目仍应补充自己的领域、设计和真实验收条件。

维护入口：[工作流](WORKFLOW.md) · [测试体系](TESTING.md) · [治理 Skill 约定](codex-profile/global-skills/README.md) · [方法论发布器](codex-profile/.codex/prompt-publisher/README.zh.md) · [GitHub 发布边界](docs/RELEASING.md)。

## 版本与验证

三平台点击入口统一调用共享安装器；macOS、Linux、Windows 的原生路径、文件部署、发布器、Hook、进程池与服务证据分开记录，不把模拟测试说成整机安装验收。机器重启、旧对话热加载、远程 HTTP MCP 发现也分别标注边界。

旧 Mac 维护命令与 Linux 窄迁移入口仍保留给维护者，**不作为新用户的默认安装方式**：

- [旧 macOS 部署说明](docs/CODEX_PROFILE_MAC.md)
- [194 上一阶段部署快照](docs/SERVER_194_GLOBAL_WORKER_DEPLOYMENT.md)
- [并行设计与证据](docs/CONCURRENCY_EVIDENCE.md)
- [Hook 注入频率实验](docs/HOOK_CONTEXT_EXPERIMENT.md)

代码和文档更新通过受保护 main 的 PR 流程交付；本仓库不分发来源或许可不清晰的第三方镜像，不把凭据放入任何平台安装包。
