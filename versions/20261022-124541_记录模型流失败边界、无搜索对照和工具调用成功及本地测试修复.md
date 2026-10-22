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
- CurrentResult: 技术资料批量入口及缓存队列已修复：8项联网约1.74秒保留108条候选并明确1项限流，8项缓存约35毫秒返回128条且HTTP为零；真实HTTP/MCP正反例通过。技术查询误排代码投递已改，13项路由通过，77条原文与9份Prompt、22个Skill无漂移。自动采用复测遇模型接口反复断流，240秒中尚未发起搜索；不能宣称端到端或实时通用网页毫秒级。
- RootCauseAnalysis: 主要断点是缓存读取被放进GitHub联网队列，以及仅提到GitHub也给代码投递加别名证据，导致快速资料入口被挤出前4项。已将缓存快路径与网络配额分离、收窄投递别名并补技术资料触发；联网与缓存单独计时，局部失败保留成功证据，模型接口断流是当前自动采用验收的外部阻塞。
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
