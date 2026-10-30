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
- CurrentResult: 全局常驻检索服务可用，但自动精准选专家仍未达标。指标审计确认68条是34场景的中英版本；49条目标命中中44条只命中一席，替换另一席为错误专家后旧分数不变。真实适用率、可执行率和任务成功率尚未知。
- RootCauseAnalysis: 旧指标只检查预设名字任一命中，忽略另一席适用性和运行阻断，且漏标等价专家；真实95字追问又被有限跟随词表当独立任务，检索缺失上文对象。独立开发题未覆盖该输入边界，目标命中不能代表推荐正确或任务成功。
- CaseStudy:
- NextIdea: 先以原角色和任务产物校准逐席适用性评审，补齐真实长追问及领域错配负例，再以该证据判断查询构造和排序修复。
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
