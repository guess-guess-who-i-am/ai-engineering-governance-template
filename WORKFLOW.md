# AI 工程实现流程

这套流程吸收了 LUAS 的渐进上下文、Agent Skills 的按需加载、DESIGN.md 的视觉上下文和 Kest 的可执行 Flow 思想。

## 1. Intake

确认用户要获得的能力、实际消费者和当前仓库状态。小而可逆的任务直接执行；只有高影响歧义才使用 `clarify-before-build`。

对产品能力建立或更新 `requirements/user-stories/US-nnn-*.md`：Actor / Need / Value 定义意图，`AC-nnn` 用 Given / When / Then 定义可证伪的成功、失败和边界结果。

当一个最终结果跨多个 Story、模块或阶段时，先建立 `requirements/user-journeys/UJ-nnn-*.md`。只有高影响歧义、跨边界实现、数据迁移、复杂发布或回滚需要时才建立 `requirements/plans/US-nnn-*.md`；可逆局部修改直接执行。

## 2. Authority routing

按 `AGENTS.md` 找到权威：术语看 `CONTEXT.md`，UI 看 `DESIGN.md`，公共行为看 contract，局部实现看最近代码与测试。

事实归属或文档联动不清楚时读 `docs/DOCUMENTATION_AUTHORITY.md`；项目开工、Story 交付、集成或发布判断读 `docs/PROJECT_LIFECYCLE.md`；新增长期服务、数据、模型、GPU、付费 API 或共享环境时读 `docs/RESOURCE_REGISTRY.md`。

## 3. First vertical slice

先让一条真实路径从输入走到消费者并可验证，再增加配置、变体和非关键抽象。禁止用大量骨架文件代替闭环。

## 4. Task-specific execution

- 故障：`systematic-debugging`
- 跨组件行为：`evolve-contracts`
- 界面：`build-designed-interface`；落地页/作品集/改版再路由 `design-taste-frontend`，手势和流体交互再路由 `apple-design`
- 高风险完成声明：`verify-before-completion`
- 建立或修复完整测试体系：`establish-test-strategy`
- 审查当前分支或 PR：`review-project-diff`
- 审查规则、Skills、CI 和证据链：`review-governance-framework`
- 修复已确认回归：`fix-regression-with-tdd`
- 统一领域术语与不变量：`model-project-domain`
- 交付前编写 PR 说明：`write-pr-description`

一次默认只加载一个主 Skill。只有边界确实跨越多个独立问题时才顺序使用第二个。

## 5. Evidence loop

每完成一个独立单元就运行最窄、可证伪的检查。失败时按机制改变方案，不重复相同尝试。保持通过的未变检查，不为仪式重复运行。

每条验收条件必须映射到真实测试文件。`quality/gates.json` 中每个必需类别都要显式标记 active、planned 或 not-applicable；planned 门禁允许项目逐步建设，但会阻止发布。详细分层和性能/安全证据边界见 `TESTING.md`。

门禁失败不只保留日志：报告生成稳定 Finding，`collect-findings.ps1` 以 fingerprint 去重，并按 `open → in_progress → resolved → testing → closed` 推进；再次失败进入 `reopened`。P0/P1 阻断边界和 Issue 同步规则见 `quality/FINDINGS.md`。

机械门禁先运行；只有清晰度、意图、层级或语气等不能稳定写成规则的判断才进入 LLM 定性门禁。定性门禁先用已知好/坏样例校准，再评价真实目标；模型只返回结构化证据，最终通过或失败由脚本按契约决定。

## 6. Delivery

交付说明必须包含：用户现在能做什么、改动边界、实际运行的证据、未验证内容和下一项真实风险。GitHub Issues/PR 应链接对应 contract、Flow 或验证日志。

完成声明按 Gate 0–4 使用真实候选、提交、环境和制品证据。Hotfix 从已部署标签或精确提交建立，不用含有未部署内容的新 `main` 替代生产事实。

## GitHub 协作建议

- `main` 始终保持可验证。
- 每项独立能力使用一个 Issue 和短生命周期分支。
- PR 描述包含 Outcome、Scope、Evidence、Risk 四部分。
- PR CI 运行 `scripts/check.ps1`；发布前运行 `scripts/invoke-quality-gates.ps1 -Profile release`，不得保留必需的 planned 门禁。
- 第三方项目优先 fork，在独立仓库维护；不要把所有上游源码复制到本模板主分支。
- 发布通过 `VERSION`、`CHANGELOG.md` 和 `v<version>` tag 驱动；Pages 与 Release 都在远程完成部署后 smoke，详见 `docs/RELEASING.md`。
