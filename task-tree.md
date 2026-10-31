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
- CurrentResult: 候选池缺陷已部署：20需求共80次前后对照身份与顺序一致，候选上限19754→500；真实入口20需求8路全部成功。排序仍未修好：短说明4B在20条职责实验里仍把skill-smith排指标追问第一；原角色4B重排12条对照中位25.399秒，若干首席匹配但第二席仍错，未部署。
- RootCauseAnalysis: 候选召回与最终名额耦合导致大图全量评分的确定缺陷已修复，但它不是错排唯一原因。实际剩余链路显示职责表示缺信息会造成主题混淆；完整角色重排虽能改善已召回首位，却约25秒且不能找回池外目标。
- CaseStudy: 专家原文被误判为任务树：维护检查把合法 Markdown 路径当作树归属；修复后按注册表与子树引用识别，保留原文并继续拦截真实超预算树。
- NextIdea: 保留已部署候选池修复，按逐席适用性与候选池外漏召回拆评既有盲测，设计低延迟双阶段方案并以真实Hook冻结输入复测后再决定部署。
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
