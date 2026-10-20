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
- CurrentResult: Windows 已采用同一 macOS 基线，9 份 Prompt、22 个 Skill 原文一致，四轮验证第 1、4 轮固定提醒且每轮路由。普通只读任务已自动读取调试与工程 Skill 并复现错误。MCP 新目录入图及 Hook 信任仍未通过，尚不能宣称全链路自动可用。
- RootCauseAnalysis: Windows 的路径、文件锁和进程通信不能直接执行 macOS 实现，当前仅适配平台绑定，不改原文与评分。MCP 目录发现不等于图更新成功，必须核对新图与真实调用。
- CaseStudy:
- NextIdea: 完成原版模型的 MCP 入图并验证推荐到实际调用闭环，待用户确认 Hook 信任后再测普通新会话自动使用。
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
