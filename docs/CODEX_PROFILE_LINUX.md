# Linux Codex 全局配置安装与恢复

这套安装包用于把仓库中的自建方法论、每轮 Hook、Skill 路由和发布器安装到 Linux 用户目录。它不会复制或修改 `auth.json`、`config.toml`、API Key、GitHub token、cookie 或 `.env`。

## 一次安装

前提：目标机已安装 Git、Node.js 18+ 和 Codex CLI，并已克隆本仓库。

```bash
cd ai-engineering-governance-template
./scripts/install-codex-profile-linux.sh
./scripts/install-codex-profile-linux.sh --check
```

安装器会先比较目标文件，只处理有变化的文件；随后在 `~/.codex/backups/portable-profile/<时间戳>/` 保存旧文件和 `manifest.json`。任一步校验失败都会自动恢复安装前内容。

已有的 `~/.codex/AGENTS.md` 不会被整体覆盖。安装器只维护两个 HTML 标记之间的模板块，用户自己的其他内容会保留。Hook 命令使用目标机当前 Node 的绝对路径，避免 SSH、systemd 或非交互 shell 找不到 `node`。

安装后启动一次 Codex TUI，确认 `UserPromptSubmit` 和 `SessionStart` 两个 dispatcher。每个事件只有一个稳定入口，新增内部路由不会再移动 Hook 索引。安装器不会伪造或直接写入 Hook 信任哈希，因为信任记录应由 Codex 根据实际 `hooks.json` 生成。

## 验证与恢复

```bash
node scripts/test-codex-profile-linux.mjs
./scripts/install-codex-profile-linux.sh --check
```

`--check` 会比较所有受管文件，运行71条方法论完整性校验、刷新 Skill 索引，并真实调用上下文 Hook 检查自动并发契约。

需要手工恢复时，打开最近备份目录的 `manifest.json`，其中列出了每个目标、原文件是否存在、安装前后 SHA-256 和备份路径。自动失败回滚已经覆盖正常安装事务；手工恢复用于安装成功后用户主动撤销。

## 已遇到的错误和正确处理

1. **SSH 非交互环境找不到 Node**：登录 shell 能运行 `node`，Hook 或 SSH 命令却失败。原因是非交互 `PATH` 不含 `~/.local/bin`。安装器把 `process.execPath` 和 Hook 路径都写成绝对路径。
2. **把 Windows 安装器用于 Ubuntu**：`.ps1` Hook、`powershell.exe` 和桌面快捷方式不能在纯 Linux 上工作。Linux 安装器只分发 `.mjs` Hook，并把发布器校验目标改成 Node 脚本。
3. **方法论发布后仍调用 Windows PowerShell**：旧发布器硬编码 `C:\Windows\...\powershell.exe`。现在 `.mjs/.js/.cjs` 用当前 Node，只有 `.ps1` 才选择 Windows PowerShell 或 `pwsh`。
4. **Git clone 留下空目录或残缺仓库**：先运行 `git status` 和 `git rev-parse --verify HEAD`。失败时删除的只能是已确认的残缺克隆目录，再重新 clone；不要覆盖一个含用户文件的目录。
5. **GitHub 443 超时**：先确认 DNS、代理和 `curl -I https://github.com`。若另一台已授权机器能访问，可用 `git bundle create` 生成可校验 bundle，经 SSH 传输后 `git fetch <bundle>`；这只是网络回退，不替代最终远端同步。
6. **Hook 显示 untrusted**：修改 `hooks.json` 或命令后，旧信任哈希会失效。重新打开 Codex TUI并逐项批准。不要通过复制别人 `config.toml` 或伪造 `trusted_hash` 绕过确认。
7. **为了信任 Hook 直接覆盖 `config.toml`**：这可能破坏模型、MCP、sandbox 或其他项目设置。本安装器完全不写 `config.toml`；任何确需修改的操作都应先备份并只做字段级变更。
8. **中文 PowerShell 文件解析异常**：Windows 脚本应使用 UTF-8 无 BOM 并显式设置输入输出编码。Linux 路径使用 Node，减少 PowerShell 版本和编码差异。
9. **官方文档站返回 HTTP 403**：不要据此猜测配置格式。优先使用已安装 CLI 的 `--help`、`doctor`、真实配置和可重复测试，并明确记录无法从官方页面确认的部分。
10. **写了“3–8 路并发”但模型仍只跑3路**：模糊建议不是执行约束。当前 Hook 要求先计算已知独立操作数 `N`，令 `K=min(N,8)`；当 `K=5–8` 时首批必须提交恰好 `K` 个真实调用，并通过重叠开始/结束时间判断真实并发。

## 凭据边界

每台电脑都要分别执行 Codex 登录和 `gh auth login`。GitHub CLI 登录只赋予该电脑上的 CLI 身份，不意味着 Agent 可以在没有用户任务授权时自行创建仓库或推送。远程 LLM 只在机器环境或 GitHub Secrets 中配置 `LLM_BASE_URL` 与 `LLM_API_KEY`，模型名可以留空，不写入本仓库。
