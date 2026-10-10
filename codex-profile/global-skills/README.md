# Skill 目录

Skills 是按需加载的专项工作流，不是常驻规则集合。
本目录是22个自有 Skill 的唯一版本源。macOS 部署器把它们安装到 `~/.agents/skills`；下游项目不复制本目录，运行时注册表也不扫描项目 Skill。

| Skill | 任务 |
|---|---|
| `clarify-before-build` | 高影响实现前冻结目标、边界与验收证据 |
| `systematic-debugging` | 沿信息流定位首个偏差并建立回归证据 |
| `evolve-contracts` | 统一演进跨组件契约、实现与端到端证据 |
| `build-designed-interface` | 依据 brief 与 `DESIGN.md` 实现完整界面 |
| `verify-before-completion` | 将完成声明映射到真实消费者与充分证据 |
| `start-new-project` | 与用户逐项冻结 brief，并生成独立的本地及私有 GitHub 项目 |
| `establish-test-strategy` | 把用户故事映射为完整、分层、可执行并阻止缺项发布的测试与 CI 体系 |
| `review-project-diff` | 审查分支或 PR 的行为缺陷、回归风险与证据缺口 |
| `review-governance-framework` | 审计规则、Skills、脚本、测试、CI 与文档的治理闭环 |
| `fix-regression-with-tdd` | 先建立失败测试，再最小修复已确认回归 |
| `model-project-domain` | 从真实业务语言建立术语、边界、不变量与契约所有权 |
| `write-pr-description` | 依据真实差异、证据、风险和回滚信息编写 PR 说明 |
| `manage-global-methodology` | 修改、翻译和发布全局方法论配置 |
| `method-research-evidence` | 路由论文、研究设计和科学证据工作 |
| `method-engineering-execution` | 路由实现、架构、调试和集成工作 |
| `method-evaluation-gates` | 路由验收、指标、测试和定性门禁工作 |
| `method-github-delivery` | 路由经授权的提交、推送和 GitHub 交付 |
| `method-task-tree` | 仅在存在任务树状态时加载任务图方法 |
| `task-tree-chain-run` | 沿任务树执行链运行一个节点 |
| `task-tree-core-state` | 精简任务树并保留决策相关状态 |
| `task-tree-grill` | 通过逐项澄清建立或修复任务图 |
| `task-tree-subtree-run` | 在授权范围内并行执行任务子树 |

## 编写规则

- 目录名与 frontmatter `name` 一致，使用 lowercase kebab-case，最多 64 字符。
- `description` 同时说明能力、触发场景和非触发边界。
- `SKILL.md` 只保留核心流程；长参考放 `references/`，重复且确定性的动作放 `scripts/`，输出资源放 `assets/`。
- 机器 ID 统一使用英文 lowercase kebab-case；中文显示名必须唯一。`agents/openai.yaml` 的字符串全部加引号，描述为 25–64 字，`default_prompt` 只引用自己的 `$skill-name`。
- 新增方法论必须在 Skill 内以独立小节保留用户原话；需要翻译时标明是原话英译，不能只留下润色后的摘要。
- 不在 Skill 内创建额外 README、安装指南或 changelog。
- 新增或修改后运行 `scripts/test-skill-validation.ps1`，并以真实任务 forward-test 复杂 Skill。校验器覆盖 Codex 的公开包约束，并额外拒绝非法 UTF-8、乱码、缺失字段、错误引用和重复显示名。
