# Hook 类别配额

全局 Hook 固定注入 8 个候选席位：完整专家按本类得分取前 2 个，普通 Skill 取前 4 个，MCP/MCP service 取前 2 个。

预过滤阶段仍共享同一张 GraphToolCall 图和同一份 embedding 矩阵；矩阵打分后按 expert、Skill、MCP 分组保留各自前排，再与原有全局语义和 BM25 保护项合并到原候选池上限内。最终仍是一轮图检索、`top_k=8`，不复制三张图、不扩大候选池，也不再先取全局 Top‑8 再分配席位。

这样可避免 Skill 等大类占满上游候选池，使相关专家和 MCP 仍能参与同一轮融合排序。类别条目不足时仍不会伪造资源；总输出不超过 8 个，类别席位是上限而非无关候选填充承诺。

## 验证

- `scripts/test-resource-graph.py`：验证全局语义前排被 Skill 占满时，类别独立语义前排仍进入固定 8 项预过滤池。
- `scripts/test-router-category-budget.mjs`：模拟 3 个专家、4 个 Skill、3 个 MCP，确认请求仍为 `top_k=8`，最终输出 2/4/2。
- `scripts/test-router-specificity.mjs`：27 条图路由和 3 条 fallback 控制通过。
- 冻结真实图挑战集 14 条中英文输入：类别数量 2/4/2 为 14/14；目标名称 Top‑8 命中从全局排序 6/14 升至 7/14。工程编排专家仍未进专家类前二，工作簿英文 Skill 因四席限制退出。详细数据见 `.reports/router-category-budget-20261026.json`。
- 已部署全局 router 与索引器；两文件 SHA 与仓库源一致。真实 `UserPromptSubmit` Hook 输出 8 项，类别为专家 2、Skill 4、MCP 2。worker 重启后首次 55 秒预热等待超时，随后 worker 就绪且真实 Hook 成功；冷启动等待仍需单独改善。

本策略改变类别候选在固定预过滤池中的保留方式；是否提高真实目标命中，仍须用冻结挑战集对照验证，不以类别配额测试代替准确率证据。
