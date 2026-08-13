# AGENTS.md

本仓库用于沉淀可复用的 AI 工程治理模板。目标不是收集越多提示词越好，而是让 Codex 能以最小上下文完成正确实现，并用真实证据证明结果。

## 快速任务路由

1. 先检查 `git status`、最近实现、测试和用户最新需求。
2. 普通局部修改只读最近的代码和测试，不预加载所有文档或 Skills。
3. 涉及全局术语、所有权或边界时读 `CONTEXT.md`。
4. 涉及 UI 视觉系统时读 `DESIGN.md`。
5. 只有触发描述明确匹配时才加载一个主 Skill；`Pair with` 或参考链接不是自动串联命令。
6. 可机械判断的规则必须由脚本、测试、契约或 Flow 验证，不能只靠模型自述。

## 权威顺序

| 事项 | 权威 |
|---|---|
| 用户目标与成功定义 | 用户最新请求 |
| 全局术语与所有权 | `CONTEXT.md` |
| 视觉语言 | `DESIGN.md` |
| 公共接口行为 | owning contract / schema |
| 局部实现规则 | 最近的 `AGENTS.md` 与现有代码 |
| 专项工作流 | 被触发的 `.agents/skills/<name>/SKILL.md` |

发生冲突时，离实际行为最近且所有权明确的权威胜出；不得通过添加兼容层掩盖冲突。

## 实施流程

1. 发现：确认当前状态、真实消费者和第一处信息流。
2. 冻结：仅对高影响歧义形成简短 build brief。
3. 最小闭环：先完成一条可运行的端到端路径。
4. 扩展：在闭环之上增加状态、边界和质量属性。
5. 验证：从最窄证据开始，跨边界时补充 contract / E2E。
6. 交付：说明结果、证据、限制和下一项未完成工作。

## 仓库规则

- 第三方完整镜像放 `upstreams/`，不提交到本仓库；来源和固定版本见 `UPSTREAMS.md` 与 `.reports/upstreams.json`。
- 不复制上游许可证不清楚的源码到我们的核心模板。
- Skills 遵循 `.agents/skills/README.md`，正文保持精简，确定性逻辑放 `scripts/`。
- 不提交 token、cookie、API key、`.env` 或机器本地配置。
- 保留用户无关改动，不进行破坏性 Git 操作。
- 没有证据时不得声称“已完成”“已修复”或“已通过”。

## 验证预算

- 仅治理文档或 Skill：运行 `scripts/validate-governance.ps1` 与 `scripts/validate-skills.ps1`。
- 脚本修改：运行对应脚本的成功与失败样例。
- UI 修改：加窄/宽视口、键盘、可访问性与定性门禁。
- 契约修改：生产者、消费者、失败语义和端到端 Flow 都要有证据。
- 发布边界：运行 `scripts/check.ps1`，不要在未改变输入时重复全量门禁。

## 常用命令

```powershell
./scripts/update-upstreams.ps1
./scripts/validate-governance.ps1
./scripts/validate-skills.ps1
./scripts/check.ps1
```

