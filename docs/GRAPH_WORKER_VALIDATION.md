# macOS 全局 GraphToolCall worker 验证

## 已验证行为

图文件约248 MB，15511工具的全局路由已部署到用户级 Hook。第一次 UserPromptSubmit 启动共享服务：一个 Unix socket 入口、4个常驻 CPU 检索进程，不同工作区和Agent复用服务。支持128个在途连接与256个等待连接，实际计算由4进程分担。默认一直驻留；重启后首次提示重新拉起，当前不注册登录启动的 LaunchAgent。

加载后启用 `tune_for_scale()`，大库通常缩小到150–500候选并保留BM25前50；信号不足时库会返回全库评分。每个进程保留图和索引，加载/版本切换互斥。模型固定CPU，查询和候选说明向量缓存4096条；入口合并相同在途请求、缓存128个结果，图版本改变后失效。关键词后备评分改为精确等价的倒排索引。Hook不再重复扫描外部库，也不再解析14MB的外部Skill注册表；系统、插件、治理入口保留。客户端55秒截止时间，超时返回错误而不退出共享入口；检索子进程崩溃后后续请求重建进程池。默认不生成新的全量检索降级进程。

## 本机实测

2026-10-11，在16 GiB Mac、真实图和本机全局Hook上执行 `scripts/benchmark-graph-load.py`。100个不同查询来自10类任务，每条追加6段完整验证要求和独立任务编号；不裁剪Hook内容、不降低完成检查。突发同时到达；错峰按每秒10、5、20、25、40个请求到达。每次独立编号防止结果缓存混淆：

| 场景 | 成功 | P50 | P95 | 最长 |
|---|---:|---:|---:|---:|
| 旧8线程服务，100长输入socket突发 | 38/100 | 55.00秒 | 55.00秒 | 55.00秒 |
| 新服务冷启动，socket突发 | 100/100 | 24.34秒 | 32.03秒 | 33.14秒 |
| 新服务预热，socket突发 | 100/100 | 10.03秒 | 17.24秒 | 18.51秒 |
| 新服务预热，socket错峰 | 100/100 | 6.66秒 | 13.93秒 | 15.37秒 |
| 完整Hook突发，全新编号未命中结果缓存 | 100/100 | 17.46秒 | 29.25秒 | 30.52秒 |
| 完整Hook错峰，全新编号未命中结果缓存 | 100/100 | 15.27秒 | 23.56秒 | 24.97秒 |
| 最终代码复测Hook错峰，另一组全新编号 | 100/100 | 17.41秒 | 28.15秒 | 30.23秒 |
| 完整Hook突发，复用结果缓存 | 100/100 | 6.68秒 | 7.39秒 | 7.57秒 |

原始报告在本机 `.reports/graph-load-before.json`、`graph-load-cold-final.json`、`graph-load-pool-warm.json`、`graph-load-pool-stagger.json`、`graph-load-hook-burst-miss.json`、`graph-load-hook-stagger-miss.json`、`graph-load-hook-burst-final.json`、`graph-load-final-review.json`。冷启动报告测得4进程合计稳定RSS 4350.6 MiB（约4.25 GiB），没有测加载峰值。命中缓存成绩不能代替首次计算延迟；全部通过是本机样本结果，不能保证任意输入、无限到达速率或其他电脑都在此上界。

复现完整Hook：运行上述脚本并指定 `--count 100 --long --warm --transport hook --seed <新编号>`；错峰再加 `--pattern stagger`。独立冷启动测试加 `--worker-entry codex-profile/mac/hooks/graph_skill_index.py`，不带 `--warm`，不重启IDE实验。可用 `--output .reports/<文件>.json` 保留每请求结果。四个检索进程各自常驻一份图，换取真正多核计算；没有100份图。

## 回归证据

- `scripts/test-graph-worker.py`：11项通过，覆盖真实GraphToolCall、20冷启动竞争、100请求突发/错峰、图更新与缓存失效、关键词评分等价、请求合并、provider缓存及上限、子进程崩溃恢复、600工具候选池、损坏图恢复、过期/错误请求、空闲退出和20后台刷新竞争。
- `scripts/test-graph-retrieval-equivalence.py`：真实图10类查询，原库与优化版本的排名、返回字段一致，最大分数差小于3×10⁻¹⁰；允许浮点批量推理舍入，不宣称位级一致。
- `scripts/test-codex-profile-mac.mjs`：安装、socket路由复用、20 Hook重叠、全局Skill、幂等、回滚和一键部署通过；补充同数量Skill内容修改及MCP定义修改的输入摘要失效测试。
- `scripts/test-parallel-run.mjs`：依赖、重叠、失败/超时回压和20硬上限通过。
- 本机全局安装与 `--check`：无管理文件漂移；Finder一键部署源已同步并检查通过。

新增外部Skill需要同时更新配置库中的 `_catalog_cn.json`；全局自有Skill放在 `~/.agents/skills`；命令行stdio MCP在全局 `config.toml` 注册。SessionStart后台比较输入摘要，重建后的图由worker自动加载。真实全库刷新后有15493个Skill（含22个治理Skill）及18个MCP工具；真实SessionStart耗时0.079秒，后台刷新正常结束。后台任务使用跨进程锁，在Hook退出后继续运行，成功才替换图；错误写到全局 `skill-registry/refresh.log`。远程HTTP MCP目录发现不在当前实现覆盖范围。

完整PowerShell仓库门禁未在本机运行：没有 `pwsh`；Skill要求的 `scripts/verify-repository.ps1` 在仓库中不存在。现有CI继续执行仓库PR门禁，并新增真实GraphToolCall worker测试。

## Git迁移补充验证

配置Git仓库分发全部自有配置、worker、候选池、安装器和测试；第三方库仍保存在已上传的私有 `skills-library` 仓库，固定commit与目录摘要写入 `codex-profile/portable-dependencies.json`。无现有库时完整部署自动恢复私有库，不再静默跳过15k+Skill；无权限则明确失败。根目录新增双击安装入口，首次安装后右键服务保持有效。

`scripts/test-global-skill-library.mjs` 验证全新用户目录的固定Git版本恢复、上游HEAD变化仍取固定版本、目录SHA-256、路径含空格、离线复用与只读检查、错误来源拒绝、下载/摘要失败清理。真实私有库远端HEAD与本机commit一致；其他物理电脑和重启尚未实测。约248MB图含机器路径，选择目标机重建，而不上传不可直接迁移的运行态图。

本次macOS全链路回归通过；更新本机后完整部署和三项检查成功，profile受管文件漂移为0、task_tree实际发布18个工具、右键服务检查为current。对265个配置仓库文本文件及私有库本次改动运行与仓库secret扫描器相同的四组模式，未发现潜在密钥；原PowerShell门禁仍因缺少pwsh未执行。任务树精炼门禁通过；流程状态检查明确报告未配置scripts/project.json，因此没有流程脚本可验证。
