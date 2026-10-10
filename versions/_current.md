# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - macOS 全局 Codex 治理配置

- Position: 120,120
- Size: 400,520
- Completion: 已完成
- Problem: 如何把仓库治理配置安装成 macOS 全局 Codex 行为，并让并发、Hook、路由和全部 Skill 真正可用？
- Approach: 全局配置继续由 Finder 右键一键部署；Skill 与 MCP 统一经过 GraphToolCall。工具执行先构造依赖 DAG，同类只读调用优先融合，普通波次从2–4路开始，成功渐增，失败或超时减半；危险、限流和共享状态任务串行，20仅为硬上限。
- Input: 仓库中的 macOS profile、用户 Codex 目录和现有非敏感配置。
- Output: 可迁移macOS配置、全局Skill安装源、常驻worker及右键服务；codex-profile/、安装全局配置.command，第三方库由私有skills-library恢复。
- Metrics: 一键部署后检查无漂移；全部全局 Skill 与 MCP 可路由；调度测试证明4路真实重叠、依赖顺序正确、失败/超时回压、危险任务串行且峰值不超过20；macOS 全链路测试通过。
- Notes: 只支持 macOS；20 是硬上限，不是首波目标。全局 Skill/MCP 经过 GraphToolCall。另一台 Mac 的重启恢复尚未实测，远程 HTTP MCP 目录发现尚未接入。
- CurrentResult: 全局 macOS 配置与常驻路由已部署；四轮 Hook 输出实测共 42,872 字节，固定提醒每轮 8,756 字节，每四轮注入一次按输出量可少 61.3%。不同任务的 Skill 推荐确实改变，动态路由仍须每轮运行。模型认证失败，跨轮保留、真实 token 与延迟尚未测得，不能宣称隔轮策略安全；详见 docs/HOOK_CONTEXT_EXPERIMENT.md。
- RootCauseAnalysis: 每次提示启动新进程会重复解析大图、重建索引并检查模型网络元数据；加载图又未恢复预过滤，导致全库语义扫描。原刷新只比较工具数量，内容变更容易漏掉，且全库重建会超出会话等待预算。
- CaseStudy:
- NextIdea: 待独立模型会话认证恢复后，用同一四轮任务序列对比每轮与每四轮固定注入，测真实 token、缓存、延迟、路由和规则遵守，再决定频率。
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
