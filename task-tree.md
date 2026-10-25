# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - macOS 全局 Codex 治理配置

- Position: 120,120
- Size: 400,520
- Completion: 进行中
- Problem: 如何把仓库治理配置安装成 macOS 全局 Codex 行为，并让并发、Hook、路由和全部 Skill 真正可用？
- Approach: 全局配置继续支持Finder右键部署；Skill与MCP统一经过GraphToolCall。工具先构造依赖DAG，同类只读调用优先融合，已知安全独立操作通常5–8路一起发出，失败或超时减半；危险、限流和共享状态任务串行，20为硬上限，遵守更低的接口限制。
- Input: 仓库中的 macOS profile、用户 Codex 目录和现有非敏感配置。
- Output: 可迁移macOS配置、全局Skill安装源、常驻worker及右键服务；codex-profile/、安装全局配置.command，第三方库由私有skills-library恢复。
- Metrics: 一键部署后检查无漂移；全部全局 Skill 与 MCP 可路由；调度测试证明4路真实重叠、依赖顺序正确、失败/超时回压、危险任务串行且峰值不超过20；macOS 全链路测试通过。
- Notes:
  - 暂停三平台检查与Git发布，先处理110用户级Codex，不影响其他用户。
  - 110清缓存释放17.62 GiB，已切KPOCE并刷新后台；API请求24.416秒完成，真实Codex首次90秒超时、重测11.395秒完成，模型代理和worker保留。
  - 194为KPOCE主路由、duck备用；duck的403不回退，认证和代理不变，整机重启未实测。
- CurrentResult: 4 个 Hook 均 trusted。未点名 turn 的路由自动命中专家并读到原入口，但 24 分钟未完成；修复共享路径后两类 Hook 均成功，第二次路由 44 秒命中两个专家候选，却停在未完成的 MCP 调用，未读专家且未验收最终分析。
- RootCauseAnalysis: 已确认并修复仓库 Hook 将项目根相对 sharedKitDir 按 llm-task-tree 子目录解析的问题。剩余真实 turn 停在 app-server 的 mcpToolCall，缺少工具名与完成事件，尚不能确认是哪个 MCP 或调度环节阻塞。
- CaseStudy:
- NextIdea: 增强回放对 MCP 工具名、参数摘要和返回事件的记录，再隔离复现停住的调用；在该调用完成后验证专家是否产出并应用分析。
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
