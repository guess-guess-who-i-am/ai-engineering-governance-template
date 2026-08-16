# Skill 目录

Skills 是按需加载的专项工作流，不是常驻规则集合。

| Skill | 任务 |
|---|---|
| `clarify-before-build` | 高影响实现前冻结目标、边界与验收证据 |
| `systematic-debugging` | 沿信息流定位首个偏差并建立回归证据 |
| `evolve-contracts` | 统一演进跨组件契约、实现与端到端证据 |
| `build-designed-interface` | 依据 brief 与 `DESIGN.md` 实现完整界面 |
| `verify-before-completion` | 将完成声明映射到真实消费者与充分证据 |
| `start-new-project` | 与用户逐项冻结 brief，并生成独立的本地及私有 GitHub 项目 |
| `establish-test-strategy` | 把用户故事映射为完整、分层、可执行并阻止缺项发布的测试与 CI 体系 |

## 编写规则

- 目录名与 frontmatter `name` 一致，使用 lowercase kebab-case，最多 64 字符。
- `description` 同时说明能力、触发场景和非触发边界。
- `SKILL.md` 只保留核心流程；长参考放 `references/`，重复且确定性的动作放 `scripts/`，输出资源放 `assets/`。
- `agents/openai.yaml` 提供 UI metadata，字符串全部加引号，`default_prompt` 必须显式引用 `$skill-name`。
- 不在 Skill 内创建额外 README、安装指南或 changelog。
- 新增或修改后运行 `scripts/validate-skills.ps1`，并以真实任务 forward-test 复杂 Skill。仓库校验器复现 Codex `quick_validate.py` 当前公开约束，但不依赖某台机器的 Codex 安装路径或 Python 包。
