# macOS Codex 全局配置安装与恢复

这套安装包用于把仓库中的自建方法论、每轮 Hook、全局 Skill 路由和发布器安装到 macOS 用户目录。它不会复制或修改 `auth.json`、API Key、GitHub token、cookie 或 `.env`；只在 `config.toml` 中合并实时搜索、Hooks、多 Agent、Agent 启用和每会话最多20并发 Agent 的安全上限这5个非敏感键，并保留其它设置。

## 一次安装

前提：目标机已安装 Git 和 Codex，并已克隆本仓库。脚本优先使用 Codex 自带 Node.js，找不到时才使用 `PATH` 中的 Node.js。

```bash
cd ai-engineering-governance-template
./scripts/deploy-codex-profile-mac.sh
```

### 不打开终端：Finder 右键

在 Finder 里右键任意工作区文件夹，在“快速操作”子菜单中直接选择“部署 Codex 全局配置”。服务调用首次部署时固化到用户 `~/.codex/tools` 的稳定源，自动运行部署、检查，并发送 macOS 通知报告结果；被选中的文件夹不需要包含本仓库脚本。

这是唯一用户入口，底层仍调用同一份可审计、可回滚的部署逻辑；Quick Action 元数据限定 Finder 文件夹输入，服务安装在 `~/Library/Services`，因此重启后仍会出现在 Finder 右键菜单。部署源和 task-tree 运行时同时固化在 `~/.codex/tools`，不依赖原仓库路径或再次联网。部署目标仍是当前用户的 `~/.codex` 和 `~/.agents/skills`，因此一次操作即可覆盖所有工作区。仓库不需要安装 Windows 安装器，也不会把配置写进项目目录。

部署脚本安装后立即做完整漂移检查。配置位于 `~/.codex` 和 `~/.agents/skills`，所以同一用户的所有工作区一次部署即可共享。

安装器会先比较目标文件，只处理有变化的文件；随后在 `~/.codex/backups/portable-profile/<时间戳>/` 保存旧文件和 `manifest.json`。任一步校验失败都会自动恢复安装前内容。

已有的 `~/.codex/AGENTS.md` 不会被整体覆盖。安装器只维护两个 HTML 标记之间的模板块，用户自己的其他内容会保留。Hook 命令使用目标机当前 Node 的绝对路径，避免 SSH、systemd 或非交互 shell 找不到 `node`。

安装后启动一次 Codex TUI，确认 `UserPromptSubmit` 和 `SessionStart` 两个 dispatcher。每个事件只有一个稳定入口，新增内部路由不会再移动 Hook 索引。安装器不会伪造或直接写入 Hook 信任哈希，因为信任记录应由 Codex 根据实际 `hooks.json` 生成；它会备份并合并上述5个非敏感配置键。

## 验证与恢复

```bash
./scripts/test-codex-profile-mac.sh
./scripts/install-codex-profile-mac.sh --check
```

安装测试由 `./scripts/test-codex-profile-mac.sh` 覆盖；它会验证 Quick Action 服务包、Finder 文件夹输入元数据、全局范围、任意工作区部署、重复部署和服务检查。

`--check` 会比较所有受管文件，运行63条方法论完整性校验、刷新 Skill 索引，并真实调用上下文 Hook 检查自动并发契约。

需要手工恢复时，打开最近备份目录的 `manifest.json`，其中列出了每个目标、原文件是否存在、安装前后 SHA-256 和备份路径。自动失败回滚已经覆盖正常安装事务；手工恢复用于安装成功后用户主动撤销。

## 已遇到的错误和正确处理

1. **SSH 非交互环境找不到 Node**：登录 shell 能运行 `node`，Hook 或 SSH 命令却失败。原因是非交互 `PATH` 不含 `~/.local/bin`。安装器把 `process.execPath` 和 Hook 路径都写成绝对路径。
2. **把项目 Skill 当作运行时来源**：仓库版本源位于不会被 Codex 自动发现的 `codex-profile/global-skills`；macOS 全局安装器把22个 Skill 复制到 `~/.agents/skills`，注册表只扫描用户级和插件根。
3. **把旧 Windows 发布脚本带入 macOS profile**：旧快照包含 PowerShell 和 VBS 入口。当前 profile 只分发 Node 与 POSIX shell 入口，方法论发布使用安装时固定的 Node 运行时。
4. **Git clone 留下空目录或残缺仓库**：先运行 `git status` 和 `git rev-parse --verify HEAD`。失败时删除的只能是已确认的残缺克隆目录，再重新 clone；不要覆盖一个含用户文件的目录。
5. **GitHub 443 超时**：先确认 DNS、代理和 `curl -I https://github.com`。若另一台已授权机器能访问，可用 `git bundle create` 生成可校验 bundle，经 SSH 传输后 `git fetch <bundle>`；这只是网络回退，不替代最终远端同步。
6. **Hook 显示 untrusted**：修改 `hooks.json` 或命令后，旧信任哈希会失效。重新打开 Codex TUI并逐项批准。不要通过复制别人 `config.toml` 或伪造 `trusted_hash` 绕过确认。
7. **为了信任 Hook 直接覆盖 `config.toml`**：这可能破坏模型、MCP、sandbox 或其他项目设置。本安装器只做字段级合并并保留其余内容；Hook 信任仍必须在 Codex 的 `/hooks` 中批准。
8. **macOS 非交互环境找不到 Node**：安装器优先固定使用 Codex 自带 Node，找不到时才使用 PATH 中的 Node；两者都不存在时明确失败。
9. **官方文档站返回 HTTP 403**：不要据此猜测配置格式。优先使用已安装 CLI 的 `--help`、`doctor`、真实配置和可重复测试，并明确记录无法从官方页面确认的部分。
10. **把“最多20路”误当成“必须凑满20路”**：固定宽度会制造无意义终端、隐藏依赖并放大失败。当前 Hook 要求先构造依赖 DAG，优先使用工具原生批量接口；普通只读波次默认2–4路，成功后逐步增加，失败、超时、限流或资源争用后减半，危险和共享状态操作保持串行。验证同时检查真实时间重叠、依赖顺序、回压和20路硬上限。

## 凭据边界

每台电脑都要分别执行 Codex 登录和 `gh auth login`。GitHub CLI 登录只赋予该电脑上的 CLI 身份，不意味着 Agent 可以在没有用户任务授权时自行创建仓库或推送。远程 LLM 只在机器环境或 GitHub Secrets 中配置 `LLM_BASE_URL` 与 `LLM_API_KEY`，模型名可以留空，不写入本仓库。
