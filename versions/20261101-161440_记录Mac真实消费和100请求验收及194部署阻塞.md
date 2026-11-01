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
- Notes: 只支持 macOS；20 是硬上限。全局 Skill/MCP 经过 GraphToolCall；跨机重启、远程 HTTP MCP 目录发现尚未实测。本机、194与110默认Terra均通过真实终端工具测试，官方目录已接入；194与110 CLI为0.166.0，110保留xhigh；桌面界面未直接验证。
- CurrentResult: 本轮两个按需 Skill 已全局入图并推送Git，原三轮 Hook 和既有方式保留。26项路由、16项 Worker、9项资源图及15项PR门禁通过，两个工作区完整读取和真实IDE Hook成功；图更新期间约29—54秒，尚未验证跨机和模型质量，不能宣称始终低延迟。
- RootCauseAnalysis: 全局刷新器与检索 Worker 来自不同版本，旧 Worker 不接受资源目录、完整性和中文向量参数，导致新增 Skill 未入图。已合并新版图接口及原有共享查询超时保护，保留三轮 Hook 与既有路由。
- CaseStudy:
  - case 1: 全部调用者超时→旧实现仍计算并缓存；新实现最后等待者取消排队任务，运行任务完成后丢弃结果。
  - case 2: 100路压测全成功但内存4.4–5.6GiB→功能与资源边界必须分开验收。
- NextIdea: 在另一台Mac复测全局部署、100请求与重启恢复，并用真实任务对照评估提示机制的质量和token消耗。
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
