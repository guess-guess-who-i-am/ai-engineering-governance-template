# ROOT 步骤报告

<!-- auto-postflight:begin -->
## 自动生成的本轮文件证据

> 此区由 Stop postflight 保底生成；Agent 应在 CurrentResult 中补充结论和测量。

- `.reports/codex-speed-diagnosis-20261027/capacity-tests.json`
- `scripts/__pycache__/benchmark-graph-load.cpython-313.pyc`
- `scripts/benchmark-graph-load.py`
<!-- auto-postflight:end -->

## 提示词清理与Git交付闭环

- 已移除Hook通用免责与重复提醒，以及已要求Git提交/推送后的重复确认；未删除代码防御性判断。
- 代码提交c2a886b已推送私有仓库codex/macos-global-deploy分支。
- 上轮验证：76条方法论、22个自有Skill、macOS安装端到端均通过；本轮重新运行路由、发布器单测及差异检查全部通过。
- 证据：outputs/prompt-cleanup-verification.json。
- 本机已于本次审计完整部署，详情见下一节；仍未验证端到端速度提升。

## 全局配置生效链审计与真实负载

- 修复生成物漏检、检查触发刷新、历史误复制、持久配置被重置、同真实路径软链接安装失败、图重复读取及中文 BM25 浮点顺序差异；各自反例回归和实际 macOS 完整部署通过。
- 全局图：15,472 外部 Skill、23 本机 Skill、4,232 完整资源模块、27 MCP 工具，缺失/无效项 0；4 进程中英文预热。默认重复安装检查 0 漂移，稳定右键部署源关键文件与本次源码一致；服务运行且配置登录自启，未实测整机重启。
- 只读图缓存交替对照减少约 5.12% 组件耗时且结果相等；Hook 字符减少 5.40%，不等于 token 降幅。
- 100 条唯一长请求错峰实测前后都全成功；改后 P95 40.21 秒、整体 46.88 秒，改前 48.73/55.21 秒。图版本和内存状态不同，不能将差值全部归因于代码，排队延迟仍高。
- 实际 Hook 8 并发全成功，P95 3.42 秒；单次真实路由 0.52 秒，确实输出专家 2 + Skill 4 + MCP 2。首次完整上下文 19,219 字符，未改注入策略，未测模型任务准确率或 token。
- 本地原有 4 进程资源规划改动保留未提交；RSS 对压缩内存的估算仍有不确定性，不声称该进程数最优。
- 证据：outputs/global-profile-audit.json、outputs/global-profile-load-{before,after,hook}.json；逐项审计、研究依据和限制见 docs/GLOBAL_PROFILE_AUDIT_20261029.md。

- 最终交付检查：compact 0 违规、治理校验、22 个仓库 Skill 校验、差异空白检查通过，GitHub 仓库保持 private。
