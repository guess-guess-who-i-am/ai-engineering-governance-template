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
- Notes: 本机后台刷新曾生成新侧车导致版本漂移，已按当前 manifest 重新同步194并逐项复核SHA；详细证据见 docs/RETRIEVAL_CONTENT_CLEANUP_20261031.zh.md。
- CurrentResult: 本机与194已发布同一清理图（19,754节点，SHA 1fc027...c264af）；本机 launchd 与远端 systemd 均常驻，194 的8并发全部成功且4个worker重叠。提交 e107f68 已推送；专家排序仍有错配，不能宣称精准推荐达标。
- RootCauseAnalysis: 类别席位仍可能把低相关专家硬塞入候选，分数未校准导致排序错配；本轮部署只验证发布一致性与并发可用性，没有改变该语义问题。
- CaseStudy: 专家原文被误判为任务树：维护检查把合法 Markdown 路径当作树归属；修复后按注册表与子树引用识别，保留原文并继续拦截真实超预算树。
- NextIdea: 当前保持已验证部署；后续若继续优化，再单独验证专家相关性阈值与类别校准。
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
