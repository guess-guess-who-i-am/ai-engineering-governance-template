# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - macOS 全局 Codex 治理配置

- Position: 120,120
- Size: 400,520
- Completion: 进行中
- Problem: 如何把仓库治理配置安装成 macOS 全局 Codex 行为，并让并发、Hook、路由和全部 Skill 真正可用？
- Approach: 全局配置继续由 Finder 右键一键部署；Skill 与 MCP 统一经过 GraphToolCall。工具执行先构造依赖 DAG，同类只读调用优先融合，普通波次从2–4路开始，成功渐增，失败或超时减半；危险、限流和共享状态任务串行，20仅为硬上限。
- Input: 仓库中的 macOS profile、用户 Codex 目录和现有非敏感配置。
- Output: 可迁移macOS配置、全局Skill安装源、常驻worker及右键服务；codex-profile/、安装全局配置.command，第三方库由私有skills-library恢复。
- Metrics: 一键部署后检查无漂移；全部全局 Skill 与 MCP 可路由；调度测试证明4路真实重叠、依赖顺序正确、失败/超时回压、危险任务串行且峰值不超过20；macOS 全链路测试通过。
- Notes: 最新要求是在 Windows 直接采用 GitHub 的 macOS 版本；跨机重启与三轮提醒的长期保持效果仍未验证。
- CurrentResult: 旧240秒复测是模型流三次失败且未搜索；新对照无搜索任务90秒无最终回答，显式资料工具调用成功，6条候选检索1.5秒。自然任务93秒完成但未采用批量工具，Hook曾44秒；索引首次预热超时、再次恢复4个当前代次进程。已修参数反馈、进度冒充答案及零候选误判，诊断/契约与15项门禁通过；上游稳定性、自然自动采用和首次预热可靠性未宣称解决。
- RootCauseAnalysis: 旧失败边界在自定义提供方Responses流而非资料检索执行；无HTTP状态及服务端日志，尚不能归因具体网关或后端。新证据另揭示参数约束引起额外往返、测试器混淆进度与最终结果、索引代次/冷启动波动及模型跳过推荐工具；这些分层记录，本地已修可确定错误并恢复预热，未用加大超时或减少校验冒称完成。
- CaseStudy:
- NextIdea: 在长期真实任务与另一台机器复测路由、冷启动和自动批量，按反例继续补充验收而非宣称每轮必有固定并发数。
- SelectedSkills:

# GraphState
- ChainForceNext: 

- Current: ROOT
- Next: ROOT
- NextPlan: 与 Agent 一起把 ROOT 拆成 3-7 个节点，设置 Current/Next/NextPlan，然后按 llm-task-tree/AGENTS.task-tree.md 逐节点推进。

# Edges

## E1 - 待建立

- Endpoints: ROOT
- LabelOffset:
- Label: 待建立子任务边
- Notes: 拆分子任务后删除或替换本边
