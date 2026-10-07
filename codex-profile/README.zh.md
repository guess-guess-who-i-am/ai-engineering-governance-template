# 可迁移 Codex 全局配置

这个目录是当前全局方法论系统的 macOS 可迁移快照。它包含：

- 全局 `AGENTS.md`；
- 全局 `config.toml` 的非敏感默认项：实时搜索、Hooks、多 Agent，以及每会话最多20个并发 Agent 的安全上限；用户已有的模型、MCP、项目和认证设置会保留；
- 每轮常驻提醒、方法论路由、Skill 推荐器和会话恢复 Hook；
- 每轮自动执行的英文自适应调度契约：先构造依赖 DAG，优先使用工具原生批量接口；普通只读任务默认从2–4路开始，成功后逐步放宽，失败、超时、限流或资源争用后减半。有副作用、破坏性、限流、需审批或共享状态不安全的操作保持串行，20只是不允许突破的硬上限；
- 每个事件只注册一个稳定 dispatcher。dispatcher 内部并发运行常驻提醒、Skill 路由、可选 capability 路由和索引刷新，避免新增 Hook 导致索引位置变化、原信任记录失效；
- 中文唯一编辑源、英文生成物、63条规则映射与完整性校验；
- 自动翻译和原子发布器；
- `method-*` 五个方法 Skill、`manage-global-methodology`、12个治理 Skill 和4个任务树 Skill，共22个全局 Skill；
- Skill 路由别名；部署时从仓库旁的私有 Skill 镜像复制约 15,472 条目录到用户级工具目录，并用 GraphToolCall 0.46.0 建立本机工具关系图索引。完整第三方库不进入本仓库，避免把混合许可的第三方内容发布到公开模板仓库。

所有调用都经过全局 GraphToolCall 路由。默认从仓库旁的私有镜像 `../skills` 部署到 `~/.codex/tools/skills`；没有该目录时复用已安装的全局库，否则自动恢复固定版本的私有Git镜像，也可通过 `CODEX_EXTERNAL_SKILL_ROOT` 指定已有目录。会话启动时把 `_catalog_cn.json` 转成 Skill 节点，并读取 `config.toml` 中命令行stdio MCP server 的 `tools/list`，统一写入 `~/.codex/skill-registry/skills.graph.json`。用户提示通过 GraphToolCall 检索，命中 Skill 后才读取原始 `SKILL.md`，命中 MCP 后显示其 server/tool 调用入口。没有可靠元数据时不伪造 producer-consumer 边。完整第三方Skill正文保存在私有Git镜像，机器路径相关的生成索引在各电脑重建。

图中的仓库自有 22 个 Skill 与第三方 Skill 一样部署到用户级全局目录；它们不写入具体项目，也不使用当前电脑的固定绝对路径。换电脑时安装器会先复制全局 Skill，再按新电脑的实际路径重建图。

macOS 检索使用按需启动的单个常驻 Python worker，同一用户的不同工作区共享图、BM25、分类索引和 embedding 模型缓存。每次加载图后显式调用 `tune_for_scale()`：大库通过分类与 embedding 中心召回候选，保留 BM25 前50项，通常限制到150–500项；信号不足时仍可回到全库评分。worker 使用用户私有 Unix socket 和进程锁，检索请求排队复用实例；图文件原子替换后自动重载，部署更新代码后旧进程退出，重启电脑后由下一次 Hook 拉起。查询只读取已缓存的本地 embedding 模型，模型下载仍在构图阶段完成。客户端总预算55秒、单次 worker 计算看门狗50秒；失败会输出诊断，不另起全量检索进程。默认持续驻留；`CODEX_GRAPH_TOOL_WORKER_IDLE_SECONDS` 可设置空闲退出秒数，0表示不退出。

真实库与 socket 回归测试：使用全局 GraphToolCall 的 Python 运行 `scripts/test-graph-worker.py`，覆盖20个冷启动竞争、单次加载、候选池、图更新、错误恢复与进程重启。

更新库时，全局自有 Skill 放到 `~/.agents/skills`；外部 Skill 放到已配置的库目录并更新 `_catalog_cn.json`；MCP 在全局 `config.toml` 注册。下次 SessionStart 在后台重新发现工具，比较外部目录摘要、全局 Skill 内容及 MCP 工具定义摘要，仅输入变化时重建图。后台刷新使用独占进程锁，重复会话不会重复构建；刷新期间查询继续用现有图。成功后原子替换，worker 在下一次查询重新加载，无须手动重启；失败记录在 `~/.codex/skill-registry/refresh.log`。当前 MCP 发现支持命令行 stdio server；远程 HTTP MCP 的目录发现仍需另外接入。

自适应并发契约会逐轮注入。`context-refresh` 把英文契约放在每次用户提示附加上下文的最前面，不再判断用户是否提到“并发”。契约要求先识别依赖与风险，优先把同类只读查询融合成一次原生批量调用，而不是为了并发数制造更多终端；机械可确定的后续轮询、收集和验证可留在同一个工具编排中。简单单步任务保持单步，失败会触发回压，存在语义依赖、交互确认、审批或破坏性的步骤保持串行。

仓库还提供 `scripts/parallel-run.mjs`：输入一个带 `tasks`、`dependsOn`、`safety`、`initialConcurrency` 和 `maxConcurrency` 的 JSON 执行计划。运行器按 DAG 就绪波次调度，默认4路，成功波次逐步加1，失败或超时后减半；`stateful`、`destructive`、`rate-limited` 任务强制单独执行，并输出每一波的宽度、时间区间、退出码、超时和依赖跳过结果。20是硬上限，不是默认宽度。

曾经出现过的退化根因是：新增 capability router 后，`context-refresh` 从 `user_prompt_submit:0:1` 移到 `0:2`，而 `config.toml` 只保留了 `0:0` 的信任记录，所以新任务没有执行并发契约。同时旧 PowerShell Skill 推荐器会用宽泛中文二元词扫描15471条外部索引，单次最坏约80秒。当前 dispatcher 固定每个事件只有一个入口，外部 Skill/MCP 检索使用上述常驻 GraphToolCall worker。

它不包含 API Key、token、cookie、`.env`、`auth.json`、GitHub 登录态、Codex 登录态、日志或历史备份。每台电脑必须单独登录；这是权限边界，不是配置缺失。

## 在 macOS 安装

下载本仓库的 `codex/macos-global-deploy` 分支，双击根目录的 **安装全局配置.command**。首次安装后会提供持久的 Finder 右键“快速操作 → 部署 Codex 全局配置”。无需手输部署命令；首次下载15k+库、Python依赖与embedding模型需要联网。先在目标电脑登录 Codex，并通过 `gh auth login` 与 `gh auth setup-git` 授权读取私有 Skill 库，或提供已有的库副本。

部署优先复用已有库；没有库时自动从私有Git仓库 `guess-guess-who-i-am/skills-library` 拉取 `portable-dependencies.json` 固定的commit，并校验目录SHA-256。访问失败会明确终止完整部署，不会默默只安装22个Skill。

```bash
./scripts/deploy-codex-profile-mac.sh
```

部署脚本先安装再执行 `--check`，成功后用户级配置会被同一用户的所有 Codex 工作区共享。项目无需复制 Hook、方法论或 Skills。

macOS 安装器优先使用 Codex 自带 Node.js 的绝对路径，不依赖非交互 shell 的 `PATH`。它只维护 `~/.codex/AGENTS.md` 中带标记的模板块，不覆盖用户自己的其他内容；每次实际变更前都会生成带 SHA-256 的 manifest 备份，失败自动回滚。

安装器不会复制认证文件或任何密钥，只在 `config.toml` 中合并上述非敏感默认项并保留其它设置。首次安装或 `hooks.json` 改变后，必须在 Codex TUI 中逐项批准 Hook；不能从其他电脑复制信任哈希。完整错误清单和恢复方法见 `docs/CODEX_PROFILE_MAC.md`。

## 在主电脑更新仓库快照

先使用 `$manage-global-methodology` 修改并发布中文唯一源。发布成功后，在本仓库运行：

```bash
./scripts/deploy-codex-profile-mac.sh
./scripts/test-codex-profile-mac.sh
```

第一条命令更新并校验本机全局配置；第二条在临时用户目录验证完整安装、并发、路由、幂等和回滚。之后再运行仓库检查并提交、推送。

不要直接修改本目录中的英文生成文件。中文唯一编辑源是 `~/.codex/prompts/global-methodology-source.zh.md`。

## 跨电脑复原范围

可复原的内容包括22个自有Skill、私有库的15,472条目录记录（其中15,471个可读取正文）、方法论源与运行文件、全局Hook与路由、常驻worker和候选池、并发调度器、task_tree MCP安装器及右键服务。全部安装在目标用户目录，不写入工作区。库新增内容先提交私有库，再更新固定版本及目录摘要；本机已安装的库会优先保留，不自动覆盖用户自定义内容。

图中约248MB的本机绝对路径、socket、venv和模型缓存不提交；安装器在目标机固定依赖版本、下载模型并按实际Skill/MCP路径重建图。这是可复建配置，不是复制运行进程。Codex自带的computer-use/cua_repl等机器专属MCP由目标机的产品运行时提供，不复制旧机命令路径或授权。自建task_tree由部署重新注册；额外MCP需在目标机注册，其stdio工具由索引发现，HTTP发现仍未覆盖。
