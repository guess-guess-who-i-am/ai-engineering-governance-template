# macOS 全局 GraphToolCall worker 验证

## 已验证行为

图文件约248 MB，15511工具的全局路由已部署到用户级 Hook。由第一次 UserPromptSubmit 按需启动 worker，默认一直驻留；同一图路径使用用户私有 Unix socket 与独占进程锁，不同工作区共享同一个实例。机器重启后首次提示会重新拉起，当前不注册登录启动的 LaunchAgent。

加载后启用 `tune_for_scale()`，大库通常缩小到150–500候选并保留BM25前50；信号不足时库会返回全库评分。图文件替换后重新加载，worker 源码部署更新后旧进程退出。客户端单轮预算55秒，worker 单次计算超过50秒退出；后续请求重新启动，没有新建全量检索进程的降级路径。

## 本机实测

执行 `scripts/benchmark-graph-worker.py --node <Node路径> --codex-home <用户Codex目录> --restart-worker`，通过已部署的 `hook-dispatch.mjs` 和真实Unix socket：

| 指标 | 观测值 |
|---|---:|
| 结束旧worker后首次Hook | 12.588秒 |
| 第二、第三次Hook，不同工作区 | 1.259、1.255秒 |
| warm socket检索 | 0.728秒 |
| 20同时请求 | 共用一个PID，加载次数保持1 |
| 20请求排队全部完成 | 最慢14.668秒 |
| 稳定RSS | 1145.2 MiB |

早先约2.65 GB是加载期间的峰值；稳定驻留内存与峰值不能混称。机器内存16 GiB。上述指标是本机样本，不是其他机器或所有查询的上界。

## 回归证据

- `scripts/test-graph-worker.py`：5项通过；真实GraphToolCall、20冷启动竞争、同PID单次加载、600工具真实候选池、图更新、损坏后恢复、过期/错误请求、进程杀死后重启、空闲退出，以及20后台刷新竞争只执行一次。
- `scripts/test-codex-profile-mac.mjs`：安装、socket路由复用、20 Hook重叠、全局Skill、幂等、回滚和一键部署通过；补充同数量Skill内容修改及MCP定义修改的输入摘要失效测试。
- `scripts/test-parallel-run.mjs`：依赖、重叠、失败/超时回压和20硬上限通过。
- 本机全局安装与 `--check`：无管理文件漂移；Finder一键部署源已同步并检查通过。

新增外部Skill需要同时更新配置库中的 `_catalog_cn.json`；全局自有Skill放在 `~/.agents/skills`；命令行stdio MCP在全局 `config.toml` 注册。SessionStart后台比较输入摘要，重建后的图由worker自动加载。真实全库刷新后有15493个Skill（含22个治理Skill）及18个MCP工具；真实SessionStart耗时0.079秒，后台刷新正常结束。后台任务使用跨进程锁，在Hook退出后继续运行，成功才替换图；错误写到全局 `skill-registry/refresh.log`。远程HTTP MCP目录发现不在当前实现覆盖范围。

完整PowerShell仓库门禁未在本机运行：没有 `pwsh`；Skill要求的 `scripts/verify-repository.ps1` 在仓库中不存在。现有CI继续执行仓库PR门禁，并新增真实GraphToolCall worker测试。

## Git迁移补充验证

配置Git仓库分发全部自有配置、worker、候选池、安装器和测试；第三方库仍保存在已上传的私有 `skills-library` 仓库，固定commit与目录摘要写入 `codex-profile/portable-dependencies.json`。无现有库时完整部署自动恢复私有库，不再静默跳过15k+Skill；无权限则明确失败。根目录新增双击安装入口，首次安装后右键服务保持有效。

`scripts/test-global-skill-library.mjs` 验证全新用户目录的固定Git版本恢复、上游HEAD变化仍取固定版本、目录SHA-256、路径含空格、离线复用与只读检查、错误来源拒绝、下载/摘要失败清理。真实私有库远端HEAD与本机commit一致；其他物理电脑和重启尚未实测。约248MB图含机器路径，选择目标机重建，而不上传不可直接迁移的运行态图。

本次macOS全链路回归通过；更新本机后完整部署和三项检查成功，profile受管文件漂移为0、task_tree实际发布18个工具、右键服务检查为current。对265个配置仓库文本文件及私有库本次改动运行与仓库secret扫描器相同的四组模式，未发现潜在密钥；原PowerShell门禁仍因缺少pwsh未执行。任务树精炼门禁通过；流程状态检查明确报告未配置scripts/project.json，因此没有流程脚本可验证。
