# AI Engineering Governance Template

一个面向 Codex 和其他 Agent Skills 兼容工具的工程治理起点，将常驻规则、领域语义、设计上下文、按需 Skills、确定性门禁和可执行 Flow 分层组织。

## 已包含

- `AGENTS.md`：任务路由、权威顺序和验证预算。
- `CONTEXT.md`：稳定术语、关系与歧义裁决。
- `DESIGN.md`：工程工具默认视觉系统。
- `.agents/skills/`：12 个按需加载且命名统一的专项工作流。
- `scripts/`：治理、Skills、敏感文件和整体检查。
- `.kest/flow/`：Markdown-native Flow 示例。
- `requirements/user-stories/`：带稳定验收条件 ID 和证据映射的用户故事。
- `quality/gates.json`：所有测试类别的显式启用、规划或不适用决策。
- `TESTING.md`：功能、契约、E2E、可访问性、性能、安全、供应链和发布证据体系。
- `UPSTREAMS.md`：第三方研究仓库与更新机制。
- `.github/`：CI、Issue 和 PR 模板。
- `qualitative/`：带正反样例校准的 LLM 定性门禁。
- `quality/findings.json`：P0–P3 问题、稳定 fingerprint、责任人和生命周期契约。
- `design/catalog.json`：74 条固定 commit、许可证和来源路径的设计参考。
- `site/`：公开文档站，带静态预算、真实浏览器、键盘和 axe 证据。
- `VERSION` / `CHANGELOG.md`：语义化版本与 GitHub Release 边界。

## 快速开始

```powershell
./scripts/update-upstreams.ps1
./scripts/check.ps1
./scripts/invoke-quality-gates.ps1 -Profile release
./scripts/search-design-references.ps1 -Query voice
```

创建一个独立的新项目时，可让 Codex 使用 `$start-new-project` 逐项填写 brief；也可直接运行交互式向导：

```powershell
./scripts/new-project.ps1
```

向导默认把项目建立在本模板的同级目录，先运行治理检查并初始化 Git；只有明确确认后才创建私有 GitHub 仓库。

创建下游项目时，首先修改 `CONTEXT.md` 和 `DESIGN.md`，再用 `$establish-test-strategy` 把 `quality/gates.json` 中的 `planned` 门禁替换为真实命令。PR 检查允许尚在建设中的明确计划；发布检查会拒绝任何仍未配置的必需门禁。

详细流程见 [WORKFLOW.md](WORKFLOW.md)。研究依据见 [外部工程规范与Agent技能调研.md](外部工程规范与Agent技能调研.md)。

用户故事与完整测试层见 [TESTING.md](TESTING.md)。`scripts/check.ps1` 运行 PR profile；`.reports/quality/` 保存结构化结果。GitHub Actions 还提供手动 release readiness 和每周安全基线检查。

公开文档站由 GitHub Pages 部署到 [项目网站](https://guess-guess-who-i-am.github.io/ai-engineering-governance-template/)。设计目录和安装边界见 [DESIGN-SOURCES.md](DESIGN-SOURCES.md)；完整 Agent Runtime 为什么应独立建仓见 [Agent 平台边界](docs/AGENT_PLATFORM_BOUNDARY.md)。

定性门禁通过 OpenAI-compatible Responses API 运行。配置与本地命令见 [qualitative/README.md](qualitative/README.md)；GitHub Actions 只需要 `LLM_API_KEY`、`LLM_BASE_URL` 两个 repository secrets，模型留空并由远程网关选择。

## GitHub 模式

本仓库只存自有治理体系。完整第三方仓库存放在本地 `upstreams/`；若需要在 GitHub 长期跟踪上游，使用 GitHub fork。只有真正成为项目依赖时才使用 submodule 或包管理器接入。

固定版本在 `upstreams.lock.json`；周任务只报告远端漂移，不自动合并上游变化。Kest 保留真实 `.flow.md` 示例和可选 CLI 接入，但因固定版本许可证文件尚未核验，不分发其二进制或源码。
