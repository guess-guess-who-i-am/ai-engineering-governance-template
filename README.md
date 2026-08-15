# AI Engineering Governance Template

一个面向 Codex 和其他 Agent Skills 兼容工具的工程治理起点，将常驻规则、领域语义、设计上下文、按需 Skills、确定性门禁和可执行 Flow 分层组织。

## 已包含

- `AGENTS.md`：任务路由、权威顺序和验证预算。
- `CONTEXT.md`：稳定术语、关系与歧义裁决。
- `DESIGN.md`：工程工具默认视觉系统。
- `.agents/skills/`：首批五个核心工作流。
- `scripts/`：治理、Skills、敏感文件和整体检查。
- `.kest/flow/`：Markdown-native Flow 示例。
- `UPSTREAMS.md`：第三方研究仓库与更新机制。
- `.github/`：CI、Issue 和 PR 模板。
- `qualitative/`：带正反样例校准的 LLM 定性门禁。

## 快速开始

```powershell
./scripts/update-upstreams.ps1
./scripts/check.ps1
```

创建一个独立的新项目时，可让 Codex 使用 `$start-new-project` 逐项填写 brief；也可直接运行交互式向导：

```powershell
./scripts/new-project.ps1
```

向导默认把项目建立在本模板的同级目录，先运行治理检查并初始化 Git；只有明确确认后才创建私有 GitHub 仓库。

创建下游项目时，首先修改 `CONTEXT.md` 和 `DESIGN.md`，删除不需要的 Skills，再加入项目自己的 contracts、tests 和部署门禁。

详细流程见 [WORKFLOW.md](WORKFLOW.md)。研究依据见 [外部工程规范与Agent技能调研.md](外部工程规范与Agent技能调研.md)。

定性门禁通过 OpenAI-compatible Responses API 运行。配置与本地命令见 [qualitative/README.md](qualitative/README.md)；GitHub Actions 只需要 `LLM_API_KEY`、`LLM_BASE_URL` 两个 repository secrets，模型留空并由远程网关选择。

## GitHub 模式

本仓库只存自有治理体系。完整第三方仓库存放在本地 `upstreams/`；若需要在 GitHub 长期跟踪上游，使用 GitHub fork。只有真正成为项目依赖时才使用 submodule 或包管理器接入。
