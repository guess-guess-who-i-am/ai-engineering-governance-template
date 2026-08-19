# 可迁移 Codex 全局配置

这个目录是当前全局方法论系统的可迁移快照，同时支持 Windows 和 Linux。它包含：

- 全局 `AGENTS.md`；
- 每轮常驻提醒、方法论路由、Skill 推荐器和会话恢复 Hook；
- 每轮自动执行的英文并发调度契约：无需用户提出并发要求，在每一波工具调用前计算当前已知独立操作数 `N`，取 `K=min(N,8)`；`K=5–8` 时必须在一次 `functions.exec` 的 `Promise.all` 中提交恰好 `K` 个真实调用。对于根据上一波结果即可机械确定的轮询、补充读取和验证，继续留在同一个 `functions.exec` 中完成，不得第一批并发后又退化成逐次模型往返；
- 每个事件只注册一个稳定 dispatcher。dispatcher 内部并发运行常驻提醒、Skill 路由、可选 capability 路由和索引刷新，避免新增 Hook 导致索引位置变化、原信任记录失效；
- 中文唯一编辑源、英文生成物、72条规则映射与完整性校验；
- 自动翻译和原子发布器；
- `method-*` 五个方法 Skill 与 `manage-global-methodology`；
- Skill 路由别名。

推荐器同时支持大型外部 Skill 库。默认读取 `E:\skills\_catalog_cn.json`，将约1.5万条名称、描述、中文问题、使用条件、分类和真实路径编译到 `~/.codex/skill-registry/external-skills.tsv`。它不会递归读取或注入这些 `SKILL.md` 正文；每轮只流式检索轻量索引，最多推荐4个候选，模型确认相关后才读取对应正文。

## 默认轻量加载

Windows 主机可运行以下命令，把大量用户 Skills、插件和重型 MCP 从“每个任务自动加载”改为“索引发现、按需启用”：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-lazy-capabilities.ps1
```

脚本会先备份 `config.toml`、Hook 和 Skill 注册表，再把非核心 `~/.codex/skills` 移到 `~/.codex/deferred-skills/codex`，把非核心 `~/.agents/skills` 移到 `~/.agents/deferred-skills`。正文不会删除；`deferred-skills.tsv` 只保存名称、描述和真实路径，推荐命中后才读取完整 `SKILL.md`。项目自己的 `.agents/skills` 不受影响。

默认只启用 capability router MCP。Codex Desktop 可能仍在 `config.toml` 中保留内置 `node_repl` 的注册信息，但迁移脚本会明确写入 `enabled = false`，所以它不会默认启动。默认层同时设置 `features.plugins = false` 和 `features.remote_plugin = false`，阻止默认插件加载和远程目录同步；实测普通 `codex exec` 不再出现插件 401、403 或 GitHub 同步等待。按需插件 profile 会显式启用对应插件，当前 Codex 版本仍可能对已启用插件执行远程 bundle 校验，这是上游运行时行为，不能仅靠 `remote_plugin=false` 完全阻止。`browser` 和 `full-tools` profile 会显式恢复 `node_repl`。以下 profile 在新任务启动时按需恢复重型能力：

```powershell
codex -p task-tree
codex -p browser
codex -p documents
codex -p pdf
codex -p spreadsheets
codex -p presentations
codex -p template-creator
codex -p full-tools
```

恢复时使用脚本输出的备份目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-lazy-capabilities.ps1 -Mode Restore -BackupPath <备份目录>
```

原始的“通常直接5到8个工具调用或者进程的并发”仍逐轮注入且没有改写。除此之外，`context-refresh.ps1` 会把英文自动执行契约放在每次用户提示附加上下文的最前面，不再判断用户是否提到“并发”。该契约要求只要存在两个以上真实独立的操作就批量提交；能根据上一波结果机械确定的后续操作继续留在同一个工具编排中。简单单步任务仍可单步执行，也不会把存在语义依赖、交互确认、审批或破坏性的步骤伪装成并发。

曾经出现过的退化根因是：新增 capability router 后，`context-refresh` 从 `user_prompt_submit:0:1` 移到 `0:2`，而 `config.toml` 只保留了 `0:0` 的信任记录，所以新任务没有执行并发契约。同时旧 PowerShell Skill 推荐器会用宽泛中文二元词扫描15471条外部索引，单次最坏约80秒。当前 dispatcher 固定每个事件只有一个入口，Skill 推荐器改用 Node、三元词和最多300条候选；本机实测推荐约0.3–0.4秒。

它不包含 API Key、token、cookie、`.env`、`auth.json`、GitHub 登录态、Codex 登录态、日志或历史备份。每台电脑必须单独登录；这是权限边界，不是配置缺失。

## 在另一台 Windows 电脑安装

先安装 Git、GitHub CLI、Node.js 和 Codex，并克隆本私有仓库。然后在仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-codex-profile.ps1
```

安装器会先把目标电脑上即将被覆盖的文件备份到 `~/.codex/backups/portable-profile/<时间戳>/`，再安装配置、按目标用户名生成 `hooks.json`、创建两个桌面编辑入口，并执行72条方法论完整性校验和 Skill 索引刷新。

安装后重新启动 Codex，使用户级 `AGENTS.md` 和 Hook 重新加载。随后分别执行 `gh auth login` 和该电脑上的 Codex 登录流程。

## 在另一台 Linux 电脑安装

```bash
./scripts/install-codex-profile-linux.sh
./scripts/install-codex-profile-linux.sh --check
```

Linux 主机安装 profile 后，可运行轻量能力迁移：

```bash
node ./scripts/configure-lazy-capabilities-linux.mjs
```

脚本备份 `config.toml` 与按需 profile，默认关闭插件和远程插件目录，把非核心 Skills 移入 deferred 目录并刷新轻量索引；存在仓库内 `llm-task-tree/mcp-server.mjs` 时生成纯 MCP 的 `task-tree` profile。恢复命令使用脚本输出的备份目录：`node ./scripts/configure-lazy-capabilities-linux.mjs --restore <备份目录>`。

Linux 安装器使用 `.mjs` Hook 和当前 Node 的绝对路径，不依赖非交互 shell 的 `PATH`。它只维护 `~/.codex/AGENTS.md` 中带标记的模板块，不覆盖用户自己的其他内容；每次实际变更前都会生成带 SHA-256 的 manifest 备份，失败自动回滚。

安装器不会读取或改写 `auth.json`、`config.toml` 和任何密钥。首次安装或 `hooks.json` 改变后，必须在 Codex TUI 中逐项批准 Hook；不能从其他电脑复制信任哈希。完整错误清单和恢复方法见 `docs/CODEX_PROFILE_LINUX.md`。

外部库不在默认路径时，在目标电脑设置：

```powershell
[Environment]::SetEnvironmentVariable("CODEX_EXTERNAL_SKILL_ROOT", "E:\skills", "User")
[Environment]::SetEnvironmentVariable("CODEX_EXTERNAL_SKILL_CATALOG", "E:\skills\_catalog_cn.json", "User")
```

设置后重新启动 Codex。首次启动会构建外部索引；后续启动只比较 catalog 的路径、长度和修改时间。外部库及生成索引都属于机器本地数据，不会随本仓库上传。

## 在主电脑更新仓库快照

先使用桌面的“编辑并发布全局 Prompt”修改中文唯一源。发布成功后，在本仓库运行：

```powershell
.\scripts\sync-codex-profile.ps1
.\scripts\sync-codex-profile.ps1 -Check
```

第一条命令把当前已发布配置同步进本目录；第二条命令验证仓库快照和本机安装完全一致。之后再运行仓库检查并提交、推送。

不要直接修改本目录中的英文生成文件。中文唯一编辑源是 `~/.codex/prompts/global-methodology-source.zh.md`。
