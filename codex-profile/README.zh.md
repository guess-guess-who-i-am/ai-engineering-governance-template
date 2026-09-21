# 可迁移 Codex 全局配置

这个目录是当前全局方法论系统的 macOS 可迁移快照。它包含：

- 全局 `AGENTS.md`；
- 全局 `config.toml` 的非敏感默认项：实时搜索、Hooks、多 Agent，以及每会话最多20个并发 Agent；用户已有的模型、MCP、项目和认证设置会保留；
- 每轮常驻提醒、方法论路由、Skill 推荐器和会话恢复 Hook；
- 每轮自动执行的英文并发调度契约：无需用户提出并发要求，在每一波工具调用前计算当前已知独立操作数 `N`，取 `K=min(N,20)`；`K=5–20` 时必须在一次 `functions.exec` 的 `Promise.all` 中提交恰好 `K` 个真实调用。对于根据上一波结果即可机械确定的轮询、补充读取和验证，继续留在同一个 `functions.exec` 中完成，不得第一批并发后又退化成逐次模型往返；
- 每个事件只注册一个稳定 dispatcher。dispatcher 内部并发运行常驻提醒、Skill 路由、可选 capability 路由和索引刷新，避免新增 Hook 导致索引位置变化、原信任记录失效；
- 中文唯一编辑源、英文生成物、63条规则映射与完整性校验；
- 自动翻译和原子发布器；
- `method-*` 五个方法 Skill、`manage-global-methodology`、12个治理 Skill 和4个任务树 Skill，共22个全局 Skill；
- Skill 路由别名。

推荐器可选支持大型外部 Skill 库。外部目录必须使用当前 macOS 的绝对路径，并编译到 `~/.codex/skill-registry/external-skills.tsv`；它不会递归读取或注入这些 `SKILL.md` 正文，每轮只流式检索轻量索引，最多推荐4个候选。

“最多20并发”的要求会逐轮注入。除此之外，`context-refresh` 会把英文自动执行契约放在每次用户提示附加上下文的最前面，不再判断用户是否提到“并发”。该契约要求只要存在两个以上真实独立的操作就批量提交；能根据上一波结果机械确定的后续操作继续留在同一个工具编排中。简单单步任务仍可单步执行，也不会把存在语义依赖、交互确认、审批或破坏性的步骤伪装成并发。

曾经出现过的退化根因是：新增 capability router 后，`context-refresh` 从 `user_prompt_submit:0:1` 移到 `0:2`，而 `config.toml` 只保留了 `0:0` 的信任记录，所以新任务没有执行并发契约。同时旧 PowerShell Skill 推荐器会用宽泛中文二元词扫描15471条外部索引，单次最坏约80秒。当前 dispatcher 固定每个事件只有一个入口，Skill 推荐器改用 Node、三元词和最多300条候选；本机实测推荐约0.3–0.4秒。

它不包含 API Key、token、cookie、`.env`、`auth.json`、GitHub 登录态、Codex 登录态、日志或历史备份。每台电脑必须单独登录；这是权限边界，不是配置缺失。

## 在 macOS 安装

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
