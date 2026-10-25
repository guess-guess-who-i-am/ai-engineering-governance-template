# Hook 类别配额

当前全局路由对已经排序出来的候选做固定上限：完整专家最多 2 个，普通 Skill 最多 4 个，MCP/MCP service 最多 2 个，总上限 8 个。

这不是扩大检索，也不是第二次分层过滤。GraphToolCall 仍使用 `top_k=8`；配额只在已有的 `explicit → capability → graph → lexical` 排序结果上去重和截断。某一类没有候选时不会伪造条目，也不会为了凑数再次查询全图。

这样可以避免某一类泛候选占满 Hook 上下文，并保留专家、Skill、MCP 三类能力的可见性。它不能修复目标专家没有进入上游候选池的问题，也不能保证每次恰好输出 8 个。

## 验证

- `scripts/test-router-category-budget.mjs`：模拟 3 个专家、4 个 Skill、3 个 MCP，确认请求仍为 `top_k=8`，最终输出 2/4/2。
- `scripts/test-router-specificity.mjs`：27 条图路由和 3 条 fallback 控制通过。
- 当前全局 Hook 的三个真实任务均遵守上限：性能任务 1/4/0，审查任务 0/4/0，后端架构任务 2/4/0。缺少 MCP 候选时没有补造 MCP。

本策略只改变 Hook 注入候选的类别平衡，不宣称提高召回率或业务正确率；上游漏召回仍需独立处理。
