# 可迁移 Codex 全局配置

这个目录是当前全局方法论系统的可迁移快照，同时支持 Windows 和 Linux。它包含：

- 全局 `AGENTS.md`；
- 每轮常驻提醒、方法论路由、Skill 推荐器和会话恢复 Hook；
- 每轮自动执行的英文并发调度契约：无需用户提出并发要求，在 Skill 加载之后先计算当前已知独立操作数 `N`，取 `K=min(N,8)`；`K=2–4` 时一次提交全部操作，`K=5–8` 时必须在一次 `functions.exec` 的 `Promise.all` 中提交恰好 `K` 个真实调用，已明确列出的最多8项独立工作必须首批全部执行，不得抽样或拆成反复返回模型思考的小批次；
- 中文唯一编辑源、英文生成物、63条规则映射与完整性校验；
- 自动翻译和原子发布器；
- `method-*` 五个方法 Skill 与 `manage-global-methodology`；
- Skill 路由别名。

推荐器同时支持大型外部 Skill 库。默认读取 `E:\skills\_catalog_cn.json`，将约1.5万条名称、描述、中文问题、使用条件、分类和真实路径编译到 `~/.codex/skill-registry/external-skills.tsv`。它不会递归读取或注入这些 `SKILL.md` 正文；每轮只流式检索轻量索引，最多推荐4个候选，模型确认相关后才读取对应正文。

原始的“通常直接5到8个工具调用或者进程的并发”仍逐轮注入且没有改写。除此之外，`context-refresh.ps1` 会在每次用户提示的上下文末尾追加英文自动执行契约，不再判断用户是否提到“并发”。该契约要求只要存在两个以上真实独立的操作就批量提交；简单单步任务仍可单步执行，也不会把存在数据依赖、交互确认、审批或破坏性的步骤伪装成并发。

它不包含 API Key、token、cookie、`.env`、`auth.json`、GitHub 登录态、Codex 登录态、日志或历史备份。每台电脑必须单独登录；这是权限边界，不是配置缺失。

## 在另一台 Windows 电脑安装

先安装 Git、GitHub CLI、Node.js 和 Codex，并克隆本私有仓库。然后在仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-codex-profile.ps1
```

安装器会先把目标电脑上即将被覆盖的文件备份到 `~/.codex/backups/portable-profile/<时间戳>/`，再安装配置、按目标用户名生成 `hooks.json`、创建两个桌面编辑入口，并执行63条方法论完整性校验和 Skill 索引刷新。

安装后重新启动 Codex，使用户级 `AGENTS.md` 和 Hook 重新加载。随后分别执行 `gh auth login` 和该电脑上的 Codex 登录流程。

## 在另一台 Linux 电脑安装

```bash
./scripts/install-codex-profile-linux.sh
./scripts/install-codex-profile-linux.sh --check
```

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
