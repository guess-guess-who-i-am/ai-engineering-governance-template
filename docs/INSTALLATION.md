# 三平台点击安装

目标：不用手输命令或代码，不需要 Agent 在现场猜步骤，装一次让同一用户的所有 Codex 工作区共用本机这一套治理配置。

## 先准备什么

1. 通过官方图形安装器安装 Codex，并完成本机登录。
2. 安装 [Git](https://git-scm.com/downloads) 和 [Python 3.10+](https://www.python.org/downloads/)。Windows 安装 Python 时启用 pip，并勾选将 Python 加入 PATH；Linux 请确认发行版提供 venv/pip。不要只装微软商店的 Python 跳转占位程序。
3. 若没有 Codex 内置 Node，安装 [Node.js LTS](https://nodejs.org/en/download)，版本至少 20。
4. 需要完整 15k+ 库时，目标 GitHub 账号必须能访问私有 skills-library。使用 GitHub Desktop 的正常登录与 Git 凭据管理，或图形安装 [GitHub CLI](https://cli.github.com/) 后按首次安装弹出的浏览器授权步骤操作。不会复制其他电脑的 GitHub 登录态。

安装器会自动安装隔离 Python 检索依赖、下载 embedding 模型、复制全部 Skills、注册 MCP、生成图与自启动服务；不自动安装整个 Codex 客户端，也不修改系统默认 Python。安装依赖和首次建图需要网络、磁盘空间，可能用时数分钟。依赖、权限或网络失败会停止并保留错误，不会把只有22个 Skill 的半套环境说成完整安装。

## 下载

登录有权限的 GitHub 账号，打开私有 `guess-guess-who-i-am/ai-engineering-governance-template`，下载 `codex/macos-global-deploy` 分支 ZIP，解压完整文件夹。不要只下载单个启动文件，也不要在压缩包预览窗口内直接运行。15k+ Skill 镜像及专家/Skill/MCP 完整模块源包各自位于私有 `skills-library`，目标账号必须获授权。

当前完整版本在 codex/macos-global-deploy 分支；main 尚未合并时请勿混用旧 main 的安装入口。GitHub Desktop 用户可克隆仓库后切换到该分支。

## Mac

双击根目录“安装全局配置-macOS.command”。旧文件名“安装全局配置.command”指向同一流程。

按系统要求确认首次运行授权，等待窗口显示全局安装及检查通过。之后在 Codex 的 Hook 管理界面批准两个受管 dispatcher；已有有效信任且入口未变时不要求反复批准。安装器不会伪造信任或自动修改系统安全设置。

LaunchAgent 在当前用户登录后自动运行常驻池，并在异常退出后重试。它不是开机登录前运行的 root LaunchDaemon。另安装 Finder 快速操作：右键工作区文件夹，在“快速操作/服务”中选择“部署 Codex 全局配置”。不能保证出现在每个应用的顶层右键菜单。

## Windows

双击根目录“安装全局配置-Windows.cmd”，按窗口中的正常授权提示操作，不需要粘贴 PowerShell 或 Git 命令。建议使用 GitHub Desktop 克隆获取仓库，避免下载文件的来源标记导致脚本运行受限。

安装器创建当前用户的 CodexGlobalGraph 计划任务，登录后启动；关闭安装窗口或重启后再次登录，不影响后续自动运行。任务采用 IgnoreNew，重复安装不会停止已有服务。查询使用仅绑定127.0.0.1的本地认证通道；端点目录限制为当前用户和SYSTEM访问，不对局域网开放。

Windows 当前入口不承诺登录前启动。PowerShell 被企业策略禁用、任务计划服务不可用时会报错；需由管理员按组织规则授权，不自动绕过策略。当前不安装 WSL，也不把 Unix socket 路径硬搬到 Windows。

## Linux 桌面

在文件管理器打开解压目录，打开“安装全局配置-Linux.desktop”，按桌面环境提示选择允许启动/运行。部分文件管理器先显示文本预览，可在文件属性的权限页允许执行后再打开。

安装器注册 systemd 用户服务，并尝试启用当前用户的 linger。若系统弹出管理员授权，正常确认即可；启用成功后，开机无需先登录也会启动。没有 systemd 用户管理器或缺少 linger 权限会明确失败，不假报自启动已验收。

纯 SSH 服务器没有文件管理器双击入口；本方案不承诺在无图形界面的 SSH 会话中“零命令点击”。维护者可通过同一个共享安装程序自动部署，不需要多 Agent。194 的既有生产服务本轮不停止、不为演示重装。

## 成功时实际检查什么

- 中文源及英文生成物的76条方法论一致，22个治理 Skill 已进入用户全局目录。
- 第三方库完整；缺失或无效条目为0，自有 Skill 与已发现 MCP 一并入图。
- embedding 模型和隔离依赖可用，常驻服务已注册、运行并通过查询预热。
- 根据 CPU/内存选择1–8个查询进程；Agent上限20与查询进程数是两回事。
- 生成用户级 install-report.json；被覆盖的受管文件备份到用户 .codex/backups。失败前已经完成的依赖下载或服务注册可能保留，解决错误后重新双击即可继续；不是跨网络、包管理器和服务管理器的全系统事务回滚。

配置只写当前用户目录，不写各工作区的 Skills；删除下载的解压目录后，已安装的 Hook、Skills、索引和服务仍来自全局目录。模型和登录账号留在每台电脑自己管理，不从模板强行覆盖。资源 Release 的完整性检查和恢复边界见 [私有资源发布与恢复](PRIVATE_RESOURCE_RELEASE.md)。

## 更新和日常使用

需要更新时下载新 ZIP，解压并再次双击对应入口。安装器备份并合并配置；你的其他 Hook、模型、provider 和非受管 Skills 保留。Mac 右键入口也保留供原有工作流使用。

安装完成后在任何项目正常使用 Codex。首次 Hook 信任、客户端登录以及新 MCP 的静态工具列表加载是客户端边界：有时需要新建对话，不能承诺所有旧会话都能无重启重建工具列表。更改提示词后，V5 会在下一请求立即刷新提醒，再恢复三轮节奏。

新安装或更换库后，第一次 embedding 下载/建图比热查询慢。后续 SessionStart 检查文件变化并后台重建，构建失败保留上次可用图；不要为每个请求重建15k+图。

## 看见错误怎么办

| 窗口信息 | 图形化处理 |
| --- | --- |
| 找不到 Node / Git / Python | 打开上方官方下载页完成安装，再双击原入口 |
| 无法读取私有 Skill 库 | 确认目标 GitHub 账号有权限，完成浏览器授权；无权限须由库所有者授予 |
| 网络下载失败 | 检查公司代理/网络与下载域名可达性，再次双击；不复制另一台机器的密钥 |
| 规则完整性或全量库校验失败 | 保留错误窗口与 install-report，交维护者定位；不要手工删条目凑通过 |
| Hook 未受信任 | 在 Codex 正常 Hook 界面批准，不复制 trusted_hash |
| 自启动注册失败 | 检查任务计划、launchd或systemd及系统授权；未通过时不能认为已完整安装 |

完整测试边界见 [安装验收](PORTABLE_PROFILE_VERIFICATION.md)。提示词相同不代表模型请求延迟相同；本方案不承诺所有电脑、所有任务达到同一个耗时。
