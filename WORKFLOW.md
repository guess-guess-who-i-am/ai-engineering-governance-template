# AI 工程实现流程

这套流程吸收了 LUAS 的渐进上下文、Agent Skills 的按需加载、DESIGN.md 的视觉上下文和 Kest 的可执行 Flow 思想。

## 1. Intake

确认用户要获得的能力、实际消费者和当前仓库状态。小而可逆的任务直接执行；只有高影响歧义才使用 `clarify-before-build`。

对产品能力建立或更新 `requirements/user-stories/US-nnn-*.md`：Actor / Need / Value 定义意图，`AC-nnn` 用 Given / When / Then 定义可证伪的成功、失败和边界结果。

## 2. Authority routing

按 `AGENTS.md` 找到权威：术语看 `CONTEXT.md`，UI 看 `DESIGN.md`，公共行为看 contract，局部实现看最近代码与测试。

## 3. First vertical slice

先让一条真实路径从输入走到消费者并可验证，再增加配置、变体和非关键抽象。禁止用大量骨架文件代替闭环。

## 4. Task-specific execution

- 故障：`systematic-debugging`
- 跨组件行为：`evolve-contracts`
- 界面：`build-designed-interface`
- 高风险完成声明：`verify-before-completion`
- 建立或修复完整测试体系：`establish-test-strategy`

一次默认只加载一个主 Skill。只有边界确实跨越多个独立问题时才顺序使用第二个。

## 5. Evidence loop

每完成一个独立单元就运行最窄、可证伪的检查。失败时按机制改变方案，不重复相同尝试。保持通过的未变检查，不为仪式重复运行。

每条验收条件必须映射到真实测试文件。`quality/gates.json` 中每个必需类别都要显式标记 active、planned 或 not-applicable；planned 门禁允许项目逐步建设，但会阻止发布。详细分层和性能/安全证据边界见 `TESTING.md`。

机械门禁先运行；只有清晰度、意图、层级或语气等不能稳定写成规则的判断才进入 LLM 定性门禁。定性门禁先用已知好/坏样例校准，再评价真实目标；模型只返回结构化证据，最终通过或失败由脚本按契约决定。

## 6. Delivery

交付说明必须包含：用户现在能做什么、改动边界、实际运行的证据、未验证内容和下一项真实风险。GitHub Issues/PR 应链接对应 contract、Flow 或验证日志。

## GitHub 协作建议

- `main` 始终保持可验证。
- 每项独立能力使用一个 Issue 和短生命周期分支。
- PR 描述包含 Outcome、Scope、Evidence、Risk 四部分。
- PR CI 运行 `scripts/check.ps1`；发布前运行 `scripts/invoke-quality-gates.ps1 -Profile release`，不得保留必需的 planned 门禁。
- 第三方项目优先 fork，在独立仓库维护；不要把所有上游源码复制到本模板主分支。
