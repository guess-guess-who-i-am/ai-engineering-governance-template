# 可迁移 Codex 全局配置

这个目录是当前全局方法论系统的可迁移快照。它包含：

- 全局 `AGENTS.md`；
- 每轮常驻提醒、方法论路由、Skill 推荐器和会话恢复 Hook；
- 中文唯一编辑源、英文生成物、59条规则映射与完整性校验；
- 自动翻译和原子发布器；
- `method-*` 五个方法 Skill 与 `manage-global-methodology`；
- Skill 路由别名。

它不包含 API Key、token、cookie、`.env`、`auth.json`、GitHub 登录态、Codex 登录态、日志或历史备份。每台电脑必须单独登录；这是权限边界，不是配置缺失。

## 在另一台 Windows 电脑安装

先安装 Git、GitHub CLI、Node.js 和 Codex，并克隆本私有仓库。然后在仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-codex-profile.ps1
```

安装器会先把目标电脑上即将被覆盖的文件备份到 `~/.codex/backups/portable-profile/<时间戳>/`，再安装配置、按目标用户名生成 `hooks.json`、创建两个桌面编辑入口，并执行59条方法论完整性校验和 Skill 索引刷新。

安装后重新启动 Codex，使用户级 `AGENTS.md` 和 Hook 重新加载。随后分别执行 `gh auth login` 和该电脑上的 Codex 登录流程。

## 在主电脑更新仓库快照

先使用桌面的“编辑并发布全局 Prompt”修改中文唯一源。发布成功后，在本仓库运行：

```powershell
.\scripts\sync-codex-profile.ps1
.\scripts\sync-codex-profile.ps1 -Check
```

第一条命令把当前已发布配置同步进本目录；第二条命令验证仓库快照和本机安装完全一致。之后再运行仓库检查并提交、推送。

不要直接修改本目录中的英文生成文件。中文唯一编辑源是 `~/.codex/prompts/global-methodology-source.zh.md`。

