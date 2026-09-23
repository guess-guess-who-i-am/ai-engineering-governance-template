# 自适应工具并发的研究与工程依据

更新时间：2026-09-23

## 结论

本仓库不再把20路并发当作目标。20只保留为运行时硬上限；普通只读工作默认从2–4路开始，按依赖 DAG 分波执行，并根据上一波的成功、失败、超时、限流和资源争用自适应增减宽度。带共享状态、副作用、破坏性、审批或限流约束的操作默认串行。

## 论文证据

| 工作 | 公开证据 | 可迁移方法 |
|---|---|---|
| LLMCompiler, ICML 2024 | 规划器、Task Fetching Unit 和并行 Executor 分离；报告最高3.7倍延迟加速、6.7倍成本节省和约9%准确率提升 | 先形成执行计划和依赖，再调度就绪节点；不能把“并行”简化为固定数量的终端 |
| An LLM-Tool Compiler for Fused Parallel Function Calling, 2024 | 在大型 Copilot 平台上选择性融合相似工具操作；报告最多4倍并行调用、最高40% token 成本和12%延迟下降 | 同类读操作优先融合为一次批量工具调用，避免让模型生成大量重复调用 |
| Divide-Then-Aggregate, ACL 2025 | 把工具搜索路径转换为 DAG，并在推理中迭代拆分并行子任务、聚合结果 | 以 DAG 就绪波次取代扁平固定宽度；聚合结果后再决定下一波 |
| ToolExpNet, ACL Findings 2025 | 同时建模工具语义相似性与依赖关系，通过自适应采样积累选择经验 | GraphToolCall 路由不能只看文本相似度，还应保留依赖与失败经验 |
| Select-Then-Decompose, EMNLP 2025 | 明确研究任务分解的效果—成本权衡，并使用自适应选择策略 | 不是所有任务都值得拆分；先判断拆分收益，再决定并发 |

论文入口：

- https://proceedings.mlr.press/v235/kim24y.html
- https://arxiv.org/abs/2405.17438
- https://aclanthology.org/2025.acl-long.1401/
- https://aclanthology.org/2025.findings-acl.811/
- https://aclanthology.org/2025.emnlp-main.278/

按 CCF 2026 年第七版人工智能目录，ACL 和 ICML 为 A 类，EMNLP 为 B 类。因此 LLMCompiler（ICML 2024）和 DTA（ACL 2025 主会长文）可标为 CCF-A 会议论文；Select-Then-Decompose（EMNLP 2025）是 CCF-B。ToolExpNet 发表在 ACL Findings，而 CCF 明确说明 Findings 不计入目录会议论文范围，所以不能把它写成 CCF-A 论文。预印本同样不自动继承会议等级。

CCF 入口：

- https://www.ccf.org.cn/Academic_Evaluation/AI/
- https://www.ccf.org.cn/Academic_Evaluation/By_category/

## 高 Star 工程项目

2026-09-23 通过 GitHub API 读取的 Star 数仅用于说明项目采用规模，会随时间变化。

| 项目 | Star | 借鉴点 |
|---|---:|---|
| microsoft/autogen | 61,117 | GraphFlow 用有向图精确控制串行、并行、条件和循环；官方还明确要求有共享内部状态的 AgentTool/TeamTool 禁止并行 |
| langchain-ai/langgraph | 42,171 | 用图结构表达分支、状态与汇合，而不是用固定线程数表达工作流 |
| deepset-ai/haystack | 26,582 | AsyncPipeline 只并行可独立运行的组件，并暴露 `concurrency_limit` 作为上限 |
| PrefectHQ/prefect | 23,904 | 把任务运行、重试、状态和限流作为调度器的一等状态 |
| SWE-agent/SWE-agent | 20,386 | 重视可观察轨迹、环境边界和可复现证据，而不是追求最大终端数量 |
| SqueezeAILab/LLMCompiler | 1,885 | 论文方法的参考实现，展示规划、取任务和执行的分层 |

工程入口：

- https://github.com/microsoft/autogen
- https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/graph-flow.html
- https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/tutorial/agents.html
- https://github.com/langchain-ai/langgraph
- https://github.com/deepset-ai/haystack
- https://docs.haystack.deepset.ai/docs/pipelines
- https://github.com/PrefectHQ/prefect
- https://github.com/SWE-agent/SWE-agent
- https://github.com/SqueezeAILab/LLMCompiler

## 落地规则

1. 调度对象是依赖 DAG，不是终端列表。
2. 能用一次原生批量 API 完成的同类读取，不拆成多个终端。
3. 普通只读任务初始宽度为4；任务不足时使用实际就绪数。
4. 全成功波次最多增加1；任一失败或超时后宽度减半，最低为1。
5. `stateful`、`destructive`、`rate-limited` 任务单独成波。
6. 依赖失败的消费者跳过，不能带着缺失输入继续执行。
7. 每波记录任务、宽度、开始/结束时间、退出码、超时和跳过原因。
8. 峰值并发不得超过20；配置超过20直接拒绝。

## 验收证据

`scripts/test-parallel-run.mjs` 必须证明：

- 4个独立只读命令的执行区间真实重叠；
- 消费者只在生产者结束后开始；
- 失败和超时使下一波宽度减半；
- 状态型任务不与其它任务重叠；
- 25个任务运行时峰值仍不超过20；
- 配置21路会被拒绝。
