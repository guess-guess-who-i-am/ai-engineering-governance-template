# Skill 目录

Skills 是按需加载的专项工作流，不是常驻规则集合。

| Skill | 任务 |
|---|---|
| `clarify-before-build` | 高影响实现前冻结目标、边界与验收证据 |
| `systematic-debugging` | 沿信息流定位首个偏差并建立回归证据 |
| `evolve-contracts` | 统一演进跨组件契约、实现与端到端证据 |
| `build-designed-interface` | 依据 brief、设计目录与 `DESIGN.md` 实现完整界面 |
| `design-taste-frontend` | 为落地页、作品集和改版建立反模板视觉方向 |
| `apple-design` | 为手势、弹簧动效和流体交互建立行为规则 |
| `verify-before-completion` | 将完成声明映射到真实消费者与充分证据 |
| `start-new-project` | 与用户逐项冻结 brief，并生成独立的本地及私有 GitHub 项目 |
| `establish-test-strategy` | 把用户故事映射为完整、分层、可执行并阻止缺项发布的测试与 CI 体系 |
| `review-project-diff` | 审查分支或 PR 的行为缺陷、回归风险与证据缺口 |
| `review-governance-framework` | 审计规则、Skills、脚本、测试、CI 与文档的治理闭环 |
| `fix-regression-with-tdd` | 先建立失败测试，再最小修复已确认回归 |
| `model-project-domain` | 从真实业务语言建立术语、边界、不变量与契约所有权 |
| `write-pr-description` | 依据真实差异、证据、风险和回滚信息编写 PR 说明 |
| `design-data-boundary` | 设计数据所有权、结构、查询索引、并发、生命周期与迁移边界 |
| `review-data-migration` | 上线前审查数据迁移的兼容、锁、回填、顺序与恢复风险 |
| `test-api-business-flow` | 对真实运行入口执行跨接口多步骤 API 业务 Flow |

## 编写规则

- 目录名与 frontmatter `name` 一致，使用 lowercase kebab-case，最多 64 字符。
- `description` 同时说明能力、触发场景和非触发边界。
- `SKILL.md` 只保留核心流程；长参考放 `references/`，重复且确定性的动作放 `scripts/`，输出资源放 `assets/`。
- 机器 ID 统一使用英文 lowercase kebab-case；中文显示名必须唯一。`agents/openai.yaml` 的字符串全部加引号，描述为 25–64 字，`default_prompt` 只引用自己的 `$skill-name`。
- 新增方法论必须在 Skill 内以独立小节保留用户原话；需要翻译时标明是原话英译，不能只留下润色后的摘要。
- 不在 Skill 内创建额外 README、安装指南或 changelog。
- 新增或修改后运行 `scripts/test-skill-validation.ps1`，并以真实任务 forward-test 复杂 Skill。校验器覆盖 Codex 的公开包约束，并额外拒绝非法 UTF-8、乱码、缺失字段、错误引用和重复显示名。
