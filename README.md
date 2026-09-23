# AI Engineering Governance Template

一个面向 Codex 和其他 Agent Skills 兼容工具的工程治理起点，将常驻规则、领域语义、设计上下文、按需 Skills、确定性门禁和可执行 Flow 分层组织。

最后更新：2026-09-21

## 已包含

- `AGENTS.md`：任务路由、权威顺序和验证预算。
- `CONTEXT.md`：稳定术语、关系与歧义裁决。
- `DESIGN.md`：工程工具默认视觉系统。
- `codex-profile/global-skills/`：22 个全局 Skill 的非自动发现版本源；安装后仅由用户级目录加载。
- `scripts/`：治理、Skills、敏感文件和整体检查。
- `.kest/flow/`：Markdown-native Flow 示例。
- `requirements/user-stories/`：带稳定验收条件 ID 和证据映射的用户故事。
- `quality/gates.json`：所有测试类别的显式启用、规划或不适用决策。
- `TESTING.md`：功能、契约、E2E、可访问性、性能、安全、供应链和发布证据体系。
- `UPSTREAMS.md`：第三方研究仓库与更新机制。
- `.github/`：CI、Issue 和 PR 模板。
- `codex-profile/`：仅面向 macOS 的全局 Codex Hook、中文方法论源、英文生成物、推荐器和发布器；安装器还合并实时搜索、Hooks、多 Agent 和20并发默认项，并从唯一 Skill 版本源安装全部22个全局 Skills；不含任何登录态或密钥。
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

## 跨电脑复用 Codex 全局配置

当前完整工程保存在公开仓库 `guess-guess-who-i-am/ai-engineering-governance-template`，默认分支是受保护的 `main`。`codex-profile/` 是本机 macOS 全局 Codex 配置的可迁移版本；安装后 Skill 只从用户级目录加载，不从项目目录加载。

### 仓库中具体保存了什么

- 全局 `AGENTS.md`：只放进入项目时需要读取一次的跨项目规则和渐进加载原则。
- 中文唯一编辑源：`codex-profile/.codex/prompts/global-methodology-source.zh.md`，保留用户中文原文，是以后增删改方法论的唯一人工入口。
- 英文运行文件：常驻提醒、完整方法论档案、方法论路由和映射文件；由中文源逐行翻译生成，不用润色摘要代替原文。
- 每轮 Hook：每次用户提示重新注入英文常驻提醒和方法论路由；会话启动、恢复、清理和压缩时也会恢复这些内容。
- 稳定 Hook dispatcher：`UserPromptSubmit` 和 `SessionStart` 各只注册一个入口，内部并发执行常驻提醒、Skill 推荐、可选 capability 推荐和索引刷新。以后增加内部路由不会移动 Hook 索引并使已有信任记录错位。
- 全局调用路由：所有自有/第三方 Skill 和已注册 MCP 的 `tools/list` 工具都先进入本机 GraphToolCall 关系图；每次提示先检索图，再读取命中的 `SKILL.md` 或调用对应 MCP server，不允许绕过索引直接发现外部 Skill/MCP。索引扫描用户级 Codex、`~/.agents/skills`、插件和配置中的 MCP，不扫描项目目录。
- 方法论发布器：保存中文源后自动翻译、备份、生成中英文文件、更新 Skills 和索引；失败时回滚。
- 22个自有全局 Skills：6个方法 Skill、12个治理 Skill 和4个任务树 Skill；安装器将它们统一写入 `~/.agents/skills`。另将仓库旁私有镜像中的约15,472条第三方 Skill 目录部署到 `~/.codex/tools/skills` 并建立机器本地路由索引，不把第三方镜像打包进公开模板仓库。仓库版本源位于不会被 Codex 自动发现的 `codex-profile/global-skills`，因此项目目录不会产生同名 Skill。
- 63条已归类方法论：常驻21条、研究9条、工程12条、评价10条、GitHub交付1条、任务树10条；机械校验保证零重复、零遗漏。
- 迁移工具：37个受管配置文件，以及安装、同步和安装测试脚本。`codex-profile/README.zh.md` 提供独立说明。

### 不会上传什么

仓库不会保存 API Key、token、cookie、`.env`、`auth.json`、GitHub 登录态、Codex 登录态、日志或机器本地备份。无论仓库公开还是私有，这些凭据都必须留在各自电脑的安全存储中。

远程 LLM 配置允许模型名留空，由远程网关选择模型；需要时只在目标电脑或 GitHub repository secrets 中设置 `LLM_BASE_URL` 和 `LLM_API_KEY`，不要写入仓库文件。

### 在 macOS 安装

先安装 Git、GitHub CLI、Codex，并确保 Codex 自带 Node.js 可用，然后运行：

```bash
gh auth login
gh repo clone guess-guess-who-i-am/ai-engineering-governance-template
cd ai-engineering-governance-template
./scripts/deploy-codex-profile-mac.sh
```

不需要打开终端时，在 Finder 中右键任意工作区文件夹，在“快速操作”子菜单中直接选择“部署 Codex 全局配置”；服务调用用户级稳定部署源并发送 macOS 通知，不要求被选中的工作区包含本仓库脚本。服务安装在当前用户的 `~/Library/Services`，重启后仍可用；部署一次后，该用户的所有 Codex 工作区都会使用同一份全局配置。

这一条命令会安装并立即执行漂移检查。配置写入用户级目录，因此同一用户的所有现有和未来 Codex 工作区都会自动使用，不需要在每个项目重复部署。

安装器会：

1. 把目标电脑上即将覆盖的文件备份到 `~/.codex/backups/portable-profile/<时间戳>/`。
2. 安装全局 `AGENTS.md`、非敏感 `config.toml` 默认项、Hook、中文源、英文生成物、发布器、路由配置和22个全局 Skills。
3. 根据目标电脑的用户目录生成 `hooks.json`，不会沿用原电脑的绝对路径。
4. 校验63条方法论的中英文对应关系并刷新 Skill 索引。

安装完成后，在该电脑单独完成 Codex 登录并重新启动 Codex，使全局 `AGENTS.md` 和 Hook 重新加载。完整说明见 [可迁移 Codex 全局配置](codex-profile/README.zh.md)。

修改过 `hooks.json` 的入口命令后，必须在 Codex 中重新批准两个 dispatcher。只看到 `user_prompt_submit:0:0` 的旧信任记录并不代表新命令已受信任；安装器不会复制或伪造 `trusted_hash`。

### 其他项目如何使用

安装完成后，这套用户级配置会被同一台电脑上的其他 Codex 项目共同使用。项目级 `AGENTS.md`、`CONTEXT.md` 和 `DESIGN.md` 仍可提供项目语义，但 Skill 统一从全局目录加载，项目 Skill 不会被注册表扫描。

`gh auth login` 只代表该电脑上的 GitHub CLI 已登录当前账号，不代表 Agent 可以在没有任务授权时任意创建仓库。用户明确要求创建或发布项目，或项目既定工作流明确要求交付时，`method-github-delivery` 才执行 commit、push 或创建私有仓库。新项目可使用 `$start-new-project` 或 `./scripts/new-project.ps1` 创建。

### 以后修改方法论并同步到 GitHub

1. 通过 `$manage-global-methodology` 修改中文唯一源并发布。
2. 等待发布器完成翻译、备份、生成、索引更新和完整性校验。
3. 在本仓库运行：

```bash
./scripts/deploy-codex-profile-mac.sh
./scripts/test-codex-profile-mac.sh
```

4. 检查 diff 和秘密扫描结果，再通过 PR 合并到受保护的公开 `main`。另一台电脑之后拉取最新 `main` 并重新运行安装脚本即可更新。

安装测试覆盖：一键部署、全新用户目录安装、旧配置备份、非敏感配置合并、macOS Node 路径生成、22个全局 Skills 安装、全局-only 注册表、系统/任务树路由输入、20路并发和失败回滚。完整仓库门禁由 macOS GitHub Actions 执行。

Finder 右键 Quick Action 已纳入 macOS 安装测试，覆盖服务安装、文件夹输入类型、任意工作区部署、重复部署幂等和服务检查。

创建下游项目时，首先修改 `CONTEXT.md` 和 `DESIGN.md`，再用 `$establish-test-strategy` 把 `quality/gates.json` 中的 `planned` 门禁替换为真实命令。PR 检查允许尚在建设中的明确计划；发布检查会拒绝任何仍未配置的必需门禁。

详细流程见 [WORKFLOW.md](WORKFLOW.md)。研究依据见 [外部工程规范与Agent技能调研.md](外部工程规范与Agent技能调研.md)。

用户故事与完整测试层见 [TESTING.md](TESTING.md)。`scripts/check.ps1` 运行 PR profile；`.reports/quality/` 保存结构化结果。GitHub Actions 还提供手动 release readiness 和每周安全基线检查。

公开文档站由 GitHub Pages 部署到 [项目网站](https://guess-guess-who-i-am.github.io/ai-engineering-governance-template/)。设计目录和安装边界见 [DESIGN-SOURCES.md](DESIGN-SOURCES.md)；完整 Agent Runtime 为什么应独立建仓见 [Agent 平台边界](docs/AGENT_PLATFORM_BOUNDARY.md)。

定性门禁通过 OpenAI-compatible Responses API 运行。配置与本地命令见 [qualitative/README.md](qualitative/README.md)；GitHub Actions 只需要 `LLM_API_KEY`、`LLM_BASE_URL` 两个 repository secrets，模型留空并由远程网关选择。

## GitHub 模式

本仓库只存自有治理体系。完整第三方仓库存放在本地 `upstreams/`；若需要在 GitHub 长期跟踪上游，使用 GitHub fork。只有真正成为项目依赖时才使用 submodule 或包管理器接入。

固定版本在 `upstreams.lock.json`；周任务只报告远端漂移，不自动合并上游变化。Kest 保留真实 `.flow.md` 示例和可选 CLI 接入，但因固定版本许可证文件尚未核验，不分发其二进制或源码。
