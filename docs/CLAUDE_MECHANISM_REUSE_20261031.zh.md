# Claude 机制对照与可复用改进

本记录对照桌面 Claude 4.4212.0 的只读分析材料与当前 macOS 全局 Codex/并行 IDE 实现。安装包分析只证明本地客户端代码路径；不证明 Claude 服务端提示词、模型路由、账户开关或远端 MCP 行为。

## 已验证且值得复用

- **技能两级加载**：常驻名称、描述、来源和启用状态；命中后本轮只读 `SKILL.md`，引用与脚本继续按需读取。当前全局运行时已经通过 `skills_list`/`skills_read` 和 GraphToolCall 路由实现这一边界。
- **代际围栏**：任务、会话、上下文和图索引都带版本或文件签名；取消、重载或分叉后，旧结果不得写回新状态。IDE 的上下文生命周期与 GraphToolCall 图重载已有该机制。
- **状态化输入队列**：区分 queued、running、等待输入、取消和已消费；结果到达时不能仅凭一个结果就标记空闲。IDE 的 coordinator 已按依赖前沿、用户补充消息和重启恢复保存状态。
- **并行调度边界**：独立只读请求滚动补位，具有真实重叠时间记录；共享状态、危险操作和不确定副作用保持串行。IDE 的 `read-wave.js`、Agent capacity 和 worktree 锁已通过定向测试。
- **会话与输出持久化**：对话使用原子替换和每文件写入队列；大输出外置保存完整流，只向模型提供小回执和检索路径。IDE 的 `thread-dialogue-store.js`、`tool-output-store.js` 已覆盖并发写和失败保留。
- **压缩安全**：压缩先准备、后提交；版本变化或存在未完成工具调用时拒绝替换历史。IDE 的上下文生命周期测试已覆盖并发完成、失败回退和上下文轮换。
- **Hook 失败语义**：同步守卫和异步审计分离；阻断必须显式记录，PostToolUse 只能反馈，不能回滚已经发生的副作用。当前 `agent-runtime.js` 已区分退出码 2、结构化 JSON、并行安全声明和同脚本队列。

## 本轮修复

GraphToolCall 的相同查询会合并到一个共享计算。原实现把首个请求的 `deadline` 传入进程池，因此短请求在排队时过期会让后来的长请求也失败。现改为：调用者继续使用自己的等待截止时间，共享计算使用独立的 55 秒硬上限。仓库 Hook 与当前全局 Hook 均已更新；故障注入验证为短请求超时、长请求成功、重复查询仍合并。

进一步复核 Claude 参考内核的 `TaskRegistry` 代际围栏后，补上了共享查询的等待者生命周期：每个调用者注册/释放 waiter；最后一个调用者超时后，尚未开始的 Future 立即取消，已经运行的计算标记为 abandoned，完成结果不得写入缓存。这里没有宣称可以安全强杀正在运行的 Python 线程/进程；这与 `concurrent.futures.Future.cancel()` 的实际语义一致。GraphToolCall 进程池外层也采用同一规则。

## 证据和边界

- 参考内核在 Python 3.9：14 项 unittest 全部通过，demo 退出 0；Python 3.13 的取消测试在加入事件屏障后也通过。参考内核的并发追加仍会产生重复序号，不能直接当生产持久化实现。
- IDE 定向测试：上下文轮换、滚动并行、历史检索、输出归档、原子会话写入和 worktree 运行时共 71 项通过（30 + 41）。
- Claude 证据审计：61 条机器证据通过；检索模型报告的 21 个偏移统一比辅助索引多 1，原始包中每条唯一命中实际为声明值减 1。已写入修正报告，未改动原始 Claude 分析材料。
- 真实 GraphToolCall 回归使用 `/Users/pku1727/.codex/tools/graph-tool-call-venv/bin/python`：worker 12 项、查询缓存 3 项、BM25 加速 4 项和检索等价 10 项全部通过；100 路 burst/stagger 各 100/100 成功。独立进程池实测 p95 约 8.6–10.6 秒，4 个查询进程常驻约 4.4–5.6 GiB；这是当前实现的资源边界，不能把它描述为低内存。
- 当前 shell 的系统 Python 没有 `graph_tool_call`，直接运行上述脚本会在初始化阶段 `ModuleNotFoundError`；该环境问题已通过固定 venv 重跑，未被隐瞒为代码失败。

## 后续优先级

1. 让发布清单同时记录仓库 Hook、全局 Hook、IDE Kit 和 GraphToolCall 版本哈希，避免本机已更新而仓库仍显示旧实现。
2. 为剩余 Claude 检索证据统一保存“原始包成员路径、偏移类型、精确片段”，不再把辅助索引偏移当权威。
3. 在另一台 Mac 复测 100 路压力、重启恢复和 4.4–5.6 GiB 资源边界；这部分不应以本机结果代替。

参考材料：`/Users/pku1727/Desktop/claude/claude-engineering/analysis/`、`/Users/pku1727/Desktop/claude/claude-engineering/reference-runtime/`、`.reports/claude-mechanism-review-20261031/`；外部边界核对见 Sparrow（SOSP 2013）、Ray（OSDI 2018）、The Tail at Scale（CACM）以及 Python `Future.cancel()` 的 Stack Overflow 实例。外部检索只用于选择机制，具体结论以本地代码和回归结果为准。
