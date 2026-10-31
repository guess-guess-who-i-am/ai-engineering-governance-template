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
- CurrentResult: 自然排序与强制配额对照已证实：SQL查询自然Top8没有专家，强制2/4/2会加入brazil-company-query等低相关专家；arXiv自然含arxiv-watcher，强制又加入prompt-engineer。字段清理改善了输入，但召回与配额排序仍未达标。
- RootCauseAnalysis: 首个偏差是category_slots在最终候选构造中硬选2名专家，没有相关性阈值或弃权；不同类别的BM25/向量分数也未校准，宽泛专家描述会放大泛词。图关系主要是显式依赖，不能补足语义适用性。
- CaseStudy: 专家原文被误判为任务树：维护检查把合法 Markdown 路径当作树归属；修复后按注册表与子树引用识别，保留原文并继续拦截真实超预算树。
- NextIdea: 冻结自然/强制双视图与逐席真值，先验证专家相关性阈值和类别校准，允许低相关席位弃权，并单独评估召回率与精确率。
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
