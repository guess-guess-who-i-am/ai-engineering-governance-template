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
- Notes: 常驻服务当前4路且100条错峰请求全成功；16GB/8核机器的6路隔离预热超时，未获得可比较吞吐。Stack Overflow案例提示底层线程过订阅会损害进程并行；worker已将BLAS/OpenMP线程限制为1。模型主动并行调用仍需单独测端到端。
- CurrentResult: 本机完整部署、全局图完整性、4进程双语预热及重复安装0漂移通过；100个错峰长请求全部成功，改后P95为40.21秒、整体46.88秒。真实Hook 8并发全成功且席位为2/4/2；整体任务加速与准确率仍未证明，排队仍高。
- RootCauseAnalysis: 发布校验、持久配置重置、同真实路径复制、中文BM25浮点顺序和图重复读取问题均已定位并修复；缓存组件对照减少5.12%耗时且结果相等。高负载仍受计算与排队约束，本机4进程的内存规划最优性未证实。
- CaseStudy:
- NextIdea: 围绕低延迟与准确执行目标，隔离测量长请求短语评分和候选排序；仅采用结果差分一致且真实负载获益的优化，并独立验证模型任务耗时与准确率。
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
