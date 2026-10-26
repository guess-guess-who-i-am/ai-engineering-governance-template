# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - macOS 全局 Codex 治理配置

- Position: 120,120
- Size: 400,520
- Completion: 进行中
- Problem: 如何把仓库治理配置安装成 macOS 全局 Codex 行为，并让并发、Hook、路由和全部 Skill 真正可用？
- Approach: 全局配置继续支持Finder右键部署；Skill与MCP统一经过GraphToolCall。工具先构造依赖DAG，同类只读调用优先融合，已知安全独立操作通常5–8路一起发出，失败或超时减半；危险、限流和共享状态任务串行，20为硬上限，遵守更低的接口限制。
- Input: 仓库中的 macOS profile、用户 Codex 目录和现有非敏感配置。
- Output: 可迁移 macOS 全局配置与一键部署；常驻 worker、全局图和 2/4/2 Hook 路由，安装说明见 codex-profile/README.zh.md。
- Metrics: 一键部署后检查无漂移；全部全局 Skill 与 MCP 可路由；调度测试证明4路真实重叠、依赖顺序正确、失败/超时回压、危险任务串行且峰值不超过20；macOS 全链路测试通过。
- Notes:
  - 暂停三平台检查与Git发布，先处理110用户级Codex，不影响其他用户。
  - 110清缓存释放17.62 GiB，已切KPOCE并刷新后台；API请求24.416秒完成，真实Codex首次90秒超时、重测11.395秒完成，模型代理和worker保留。
  - 194为KPOCE主路由、duck备用；duck的403不回退，认证和代理不变，整机重启未实测。
- CurrentResult: 本机已部署 15,495 个 Skill、27 个 MCP 工具和 4,232 个模块，缺失/无效 Skill 为 0；LaunchAgent 运行，真实 Hook 输出专家/Skill/MCP=2/4/2。冻结任务集目标名命中仍为 7/14，准确率未达标；静态工具列表需新会话刷新。
- RootCauseAnalysis: 类别席位只保证三类候选进入固定 8 项，不保证与任务相关；冻结集仍有 7/14 目标命中。完整专家相关性还受上游召回和排序影响，需按漏项定位。
- CaseStudy:
- NextIdea: 逐条检查 14 条挑战集中未命中的目标，在 top_k=8、2/4/2 下区分漏召回与弱排序，并复测目标命中及 Hook 耗时。
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
