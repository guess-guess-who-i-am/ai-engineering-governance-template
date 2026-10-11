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
- CurrentResult: macOS 全局检索已部署4个常驻进程和轻量Hook注册表；100个不同长输入突发、错峰均100/100成功，完整Hook未命中结果缓存时P95约29.25/23.56秒，冷启动最长33.14秒。10类查询排名和返回字段与原库一致。三轮提醒长期质量及另一台Mac重启恢复仍未验证，整体目标尚未完全达成。
- RootCauseAnalysis: 原单连接、大锁和Hook重复扫描外部全库导致排队；embedding重排绕过缓存和互斥，Metal并发会崩溃。现用4进程池、图版本缓存、在途请求合并及CPU模型缓存，并删去每轮重复外部注册表。
- CaseStudy:
- NextIdea: 持续监测真实长任务和完成检查的检索延迟、失败率与缓存命中，并在另一台Mac验证重启恢复和三轮提醒质量。
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
