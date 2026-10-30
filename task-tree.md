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
- CurrentResult: 原角色能力范围已全局部署：446位有可追溯范围，1位缺唯一主角色明确阻塞；50次请求全成功、8路重叠、4进程，名单分数不变，两个工作区6次Hook通过。8种描述替换未超过34/44；精准自动选专家仍未达标，不能要求用户报专家名。
- RootCauseAnalysis: 专家导入器把市场简介、标签和重复示例直接拼成检索描述，未以原主角色核准领域；广告搜索被泛化为通用检索，长描述又挤掉中文能力。已定位首个失真边界，正以原角色描述和无专家名需求做隔离对照；自动精准选专家仍未达标。
- CaseStudy:
- NextIdea: 以原角色适用领域评审自然需求返回的两位专家，区分真实错配与等价专家，再验证不扩大候选池的领域感知排序；保留现有全局服务。
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
