# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - macOS 全局 Codex 治理配置

- Position: 120,120
- Size: 400,520
- Completion: 已完成
- Problem: 如何把仓库治理配置安装成 macOS 全局 Codex 行为，并让并发、Hook、路由和全部 Skill 真正可用？
- Approach: 全局配置继续由 Finder 右键一键部署；Skill 与 MCP 统一经过 GraphToolCall。工具执行先构造依赖 DAG，同类只读调用优先融合，普通波次从2–4路开始，成功渐增，失败或超时减半；危险、限流和共享状态任务串行，20仅为硬上限。
- Input: 仓库中的 macOS profile、用户 Codex 目录和现有非敏感配置。
- Output: `/Users/pku1727/.codex` 与 `/Users/pku1727/.agents/skills` 中的可运行全局配置。
- Metrics: 一键部署后检查无漂移；全部全局 Skill 与 MCP 可路由；调度测试证明4路真实重叠、依赖顺序正确、失败/超时回压、危险任务串行且峰值不超过20；macOS 全链路测试通过。
- Notes: 只支持 macOS；22 个 Skill 统一安装到用户级目录，项目 Skill 源不参与运行时注册。Hook 信任由 Codex 交互式审核记录，不能由安装器伪造。
- CurrentResult: 真实全局 Hook 已注入 V4 自适应契约，安装后的调度器与仓库一致；专用测试覆盖 DAG、4路重叠、回压、串行安全和20硬上限，完整 macOS 安装测试通过；GraphToolCall 全局图的 v0.3.0 Release 资产已验证存在。尚待提交推送并观察远端 CI。
- RootCauseAnalysis: 旧契约把20这个容量上限当成首波配额，导致模型为凑数量拆分终端、忽略依赖与失败回压。根因是调度目标按调用数量定义，而不是按依赖图、风险和实际执行反馈定义。
- CaseStudy:
- NextIdea: 提交并推送自适应调度版本，观察远端 CI 后记录最终交付状态。
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
