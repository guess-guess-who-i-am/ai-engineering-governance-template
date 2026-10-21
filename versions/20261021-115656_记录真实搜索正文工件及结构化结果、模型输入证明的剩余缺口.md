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
- CurrentResult: 本机77条方法论与9份Prompt、22个Skill无漂移，四个进程代码和图版本一致。已部署跨进程描述向量缓存与分层计时，真实质量10例及15项门禁通过；相关查询单样本约837毫秒，重复约2毫秒，首次仍约1.7秒。自然任务复测约106秒，搜索5.8秒、约86秒在工具外；整体毫秒级和稳定提速未达标，过宽Skill误触发尚待对照，跨机长期未验证。
- RootCauseAnalysis: 先前把任务总耗时混作搜索耗时，分层后发现主要等待处于工具之外，不能归因于并发上限。已修每个进程重复编码静态描述及磁盘更新不等于内存更新的问题；全库预计算超时已撤回，普通文档查证额外加载开放式发现Skill是新假设，尚未证明其解释全部等待。
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
