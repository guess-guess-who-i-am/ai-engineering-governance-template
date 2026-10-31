# ROOT 步骤报告

<!-- auto-postflight:begin -->
## 自动生成的本轮文件证据

> 此区由 Stop postflight 保底生成；Agent 应在 CurrentResult 中补充结论和测量。

- `.reports/expert-direct-global-verification.json`
- `.reports/expert-repair-20261030/baseline-skill-router.mjs`
- `.reports/expert-repair-20261030/check.stderr`
- `.reports/expert-repair-20261030/check.stdout`
- `.reports/expert-repair-20261030/conqrr.source`
- `.reports/expert-repair-20261030/conqrr.txt`
- `.reports/expert-repair-20261030/continuity-live.json`
- `.reports/expert-repair-20261030/continuity-live.stderr`
- `.reports/expert-repair-20261030/continuity-live.stdout`
- `.reports/expert-repair-20261030/continuity-red.stderr`
- `.reports/expert-repair-20261030/continuity-red.stdout`
- `.reports/expert-repair-20261030/deployment.json`
- `.reports/expert-repair-20261030/direct-global.stderr`
- `.reports/expert-repair-20261030/direct-global.stdout`
- `.reports/expert-repair-20261030/dispatcher-live.json`
- `.reports/expert-repair-20261030/judge-calibration-cases.json`
- `.reports/expert-repair-20261030/judge-calibration-final.stderr`
- `.reports/expert-repair-20261030/judge-calibration-final.stdout`
- `.reports/expert-repair-20261030/judge-calibration-invalid-result.json`
- `.reports/expert-repair-20261030/judge-calibration-result-final.json`
- `.reports/expert-repair-20261030/judge-calibration-result.json`
- `.reports/expert-repair-20261030/langchain-libs.source`
- `.reports/expert-repair-20261030/langchain-meta.source`
- `.reports/expert-repair-20261030/live-roles.json`
- `.reports/expert-repair-20261030/mmarco-category50.json`
- `.reports/expert-repair-20261030/mmarco-category50.stderr`
- `.reports/expert-repair-20261030/mmarco-category50.stdout`
- `.reports/expert-repair-20261030/mmarco-followups.json`
- `.reports/expert-repair-20261030/mmarco-followups.stderr`
- `.reports/expert-repair-20261030/mmarco-followups.stdout`
- `.reports/expert-repair-20261030/mmarco-model.source`
- `.reports/expert-repair-20261030/qwen-category50-description.json`
- `.reports/expert-repair-20261030/qwen-category50-description.stderr`
- `.reports/expert-repair-20261030/qwen-category50-description.stdout`
- `.reports/expert-repair-20261030/qwen-category50-role.json`
- `.reports/expert-repair-20261030/qwen-category50-role.stderr`
- `.reports/expert-repair-20261030/qwen-category50-role.stdout`
- `.reports/expert-repair-20261030/qwen-followups.json`
- `.reports/expert-repair-20261030/qwen-followups.stderr`
- `.reports/expert-repair-20261030/qwen-followups.stdout`
- `.reports/expert-repair-20261030/qwen-role-existing-pool.json`
- `.reports/expert-repair-20261030/qwen-role-existing-pool.stderr`
- `.reports/expert-repair-20261030/qwen-role-existing-pool.stdout`
- `.reports/expert-repair-20261030/requirement-meaning-red.stderr`
- `.reports/expert-repair-20261030/so.source`
- `.reports/expert-repair-20261030/sources.json`
- `.reports/expert-repair-20261030/specificity-fixed.stderr`
- `.reports/expert-repair-20261030/specificity-fixed.stdout`
- `.reports/expert-repair-20261030/specificity-installed.stderr`
- `.reports/expert-repair-20261030/specificity-installed.stdout`
- `.reports/expert-repair-20261030/supplemental-sources.json`
- `.reports/expert-repair-20261030/umbrela-meta.source`
- `.reports/expert-repair-20261030/umbrela-rubric.source`
- `.reports/expert-repair-20261030/umbrela-tree.source`
- `.reports/expert-repair-20261030/umbrela.source`
- `.reports/expert-repair-20261030/zeco-paper.source`
- `.reports/expert-repair-20261030/zeco-paper.txt`
- `.reports/expert-repair-20261030/zeco.source`
- `.reports/quality/pr.json`
- `.reports/site-test/.nojekyll`
- `codex-profile/.codex/hooks/skill-router.mjs`
- `docs/evidence/expert-applicability-review-20261030.json`
- `docs/evidence/expert-applicability-summary-20261030.json`
- `docs/evidence/expert-continuity-run-20261030.json`
- `docs/evidence/expert-deployment-20261030.json`
- `docs/evidence/expert-judge-calibration-20261030.json`
- `docs/evidence/expert-rerank-probes-20261030.json`
- `docs/evidence/expert-verification-wave-20261030.json`
- `scripts/__pycache__/calibrate-expert-applicability-judge.cpython-313.pyc`
- `scripts/__pycache__/evaluate-expert-applicability.cpython-313.pyc`
- `scripts/__pycache__/experiment-continuity-rerank.cpython-313.pyc`
- `scripts/__pycache__/test-expert-applicability.cpython-313.pyc`
- `scripts/benchmark-router-continuity.mjs`
- `scripts/calibrate-expert-applicability-judge.py`
- `scripts/evaluate-expert-applicability.py`
- `scripts/experiment-continuity-rerank.py`
- `scripts/test-expert-applicability.py`
- `scripts/test-router-context-continuity.mjs`
- `scripts/test-router-specificity.mjs`
- `scripts/verify-expert-direct-global.mjs`
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

## 真实专家使用频率审计

- UTC 10月24–29日本机77份会话日志去重为191轮：66轮明确推荐专家；4轮确认完整原文读取，全部在专家审计/试用链路。其他工作区136轮未发现完整读取。读取不等于执行；普通任务的完整专家交付未找到可核验证据。
- IDE诊断309次唯一skills_read未保留资源身份，真实专家使用率未知；不把日志盲区计作零使用。
- 根因：类别排名与任务适用脱节、候选到执行未闭环、部分原包宿主工具缺失；此前远端资源缺部署，本轮未重测远端。没有修改生产配置。
- 证据：outputs/expert-usage-audit-20261030.json；详细口径、案例和树字段旧→新回执见docs/EXPERT_USAGE_AUDIT_20261030.md。树精炼、治理及22个仓库Skill校验通过。

## 完整向量输入编码与全局常驻部署

完整编码与全局入口已验证，精准专家排序仍未达标。详见 [实验报告](../../../../docs/EMBEDDING_TRUNCATION_REPAIR_20261031.zh.md)。16条突发请求全部成功；8条分类并发查询均保持2/4/2；两个工作区Hook候选相同。合成长查询仍有背景干扰，未将其当作推荐成功。

## 检索白名单字段清理与全局常驻发布

专家初始提示、快捷示例和内部ID，以及Skill分类辅助字段已退出相关性文本。19,754节点保留，70条配额核验、8条真实并发及两个工作区Hook通过；专家排序仍有错配。证据与边界见 docs/RETRIEVAL_CONTENT_CLEANUP_20261031.zh.md。

本轮完成 194 服务器发布：与本机相同的图 SHA-256 为 `1fc027c532a90d5be0c92d5c8620277613640f62db72a6f2324296e04c264af8`；远端 `codex-graph-worker.service` 已 `enabled`、`active`，`Restart=always`，4 个 worker 参与 8 条重叠请求并全部成功，中英文预热与 `prefilter` 检查通过。远端旧图与新 hook 不匹配导致的启动错误已通过原子替换清除。
