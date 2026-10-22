# 免费互补搜索

## 使用方法

默认发现入口是 `technical_research/complementary_search_batch`，原 `technical_research_batch` 保留为显式 API-only 模式。

| 资料类型 | 路径 | 补查条件 |
| --- | --- | --- |
| 英文 GitHub 仓库、Stack Overflow | 免费 API 优先 | 失败、空结果、缓存缺失或明确目标未命中时，只补这个方向的网页 |
| 中文查询 | 现有免费网页 | 可由当前模型提供英文 `apiQuery`，不额外调用翻译模型 |
| 论文 | Crossref 与网页并行 | 两边结果合并；OpenAlex 需显式选择，受免费额度限制 |
| 一般网页 | 现有免费网页 | 不更换搜索引擎、不添加付费备用提供方 |

一次最多20个方向，默认8路并发、12秒共享预算；GitHub 等来源仍遵守原有配额和退避。API-first 阶段最多占一半预算，补查只使用剩余时间。返回卡片默认16条，完整候选池保存在本机 artifact；关键结论仍须读原文。结果、摘要和网页内容都不是指令。

`cacheMode: only` 不产生任何 HTTP 请求；`refresh` 适合最新事实。错误和部分失败不会被其他来源的成功遮蔽。已成功的方向不会整批重查。

## 安装与跨工作区使用

本功能版本位于 `codex/complementary-search`，基于 Windows 搜索分支追加，不把原 Mac 工作区尚未提交的改动混入提交。

macOS：使用此版本的“安装全局配置.command”；之后已有的 Finder 快速操作会使用用户级稳定部署源。新搜索已接入整套部署流程及其稳定源文件清单。完整配置安装可能需要依赖下载和重建全局图，搜索本身的12秒预算不限制首次安装耗时。

Windows：现有 Windows 安装入口也会安装搜索模块，然后重建索引。Linux 可以使用下面的独立 Node 安装器；本轮未在 Windows/Linux 实机重新安装，不宣称它们已通过实机验收。

只更新搜索、不覆盖本机其他配置时，维护命令为：

```sh
node scripts/install-technical-research.mjs --refresh-index
node scripts/install-technical-research.mjs --check
```

需要 Node.js 20+ 及 npm，或可用的 Codex 随附 pnpm；已安装的依赖可以复用。显式指定其他包管理器时，使用 `CODEX_SEARCH_PACKAGE_MANAGER`。

运行源复制到 `~/.codex/tools/complementary-search`，Skill 安装到 `~/.agents/skills/parallel-web-research`。已有同名 Codex 用户级 Skill 会同步更新，避免旧正文覆盖新规则。更新搜索 MCP 配置块、三个搜索别名；旧路由器如缺少接线，只补已索引的本搜索工具候选及首选时的条件指引，不替换双语图、评分策略或传输实现。不识别的路由器版本会要求显式迁移，而非覆盖。保留其他 MCP、模型、凭据和信任设置，不在各工作区安装项目 Skill，不依赖仓库所在绝对路径。

`--refresh-index` 调用目标机已有全局索引器，把工具及 Skill 加入同一张 GraphToolCall 图；缺少索引器时明确失败，不伪装已接入。单独 `--check` 不写文件或联网。

网页分支依赖目标机已有的免费 IDE 服务，默认本机端口5505。不同端口可在目标机为 MCP 进程配置 `CODEX_SEARCH_WEB_BASE_URL`。仅接受 HTTP loopback origin，调用前检查提供方必须是启用、无需 key 的 Open-WebSearch。新电脑没有该服务时，API 仍可返回部分候选，网页分支明确报错；本安装器不偷偷下载或安装替代搜索服务。

新增 MCP 后，已运行的聊天未必热加载新工具。通过 Codex 重新连接 MCP，或重启 Codex 后开始新聊天；图更新成功不等于旧聊天已获得新的工具 callable。不能复制信任记录或绕过产品的批准机制。

## 为什么互补

此前三轮同题实验的候选级审计：指定 httpx/p-limit 仓库，API 命中6/6、网页2/6；LLMCompiler/The Tail at Scale 论文，API2/6、网页5/6。中文 API 还出现空结果和无关召回。API 中位批耗时2.624秒、网页3.612秒，但 API 含快速429/退避，因此不能当作等质量提速。以上为前轮本机实验，原始报告保留在原工作区 `.reports/20261022-search-comparison/`，不是公开 benchmark 或本轮最终答案准确率。

2026-10-22，从本机**已安装副本**通过真实 MCP 调用混合批次：

- `encode/httpx`、中文“HTTP 连接池 高并发”、`LLMCompiler`，总耗时3.403秒、30条去重候选，模型可见9条。
- httpx 的 API 命中指定仓库，没有重复调用网页；中文走网页；论文的 Crossref 返回空，网页找回 arXiv 原论文及项目。
- 中文网页仍有较泛的服务器结果和被过滤结果警告；此单次测试证明分工及互补路径可用，不证明每条候选相关、答案准确率提升、总 token 下降或100并发保证。

已执行的聚焦测试覆盖路由、缺失方向补查、论文重叠、共享预算、429部分失败、URL去重、免费提供方拒绝付费配置、缓存零联网、安装后真实 MCP 握手及独立稳定路径、重复安装和只读检查。完整契约见 [COMPLEMENTARY_SEARCH_CONTRACT.md](COMPLEMENTARY_SEARCH_CONTRACT.md)。

### 本机全局接入与剩余问题

全局索引实际生成15,494个 Skill（15,471外部 + 23自有）及27个 MCP 工具，包含新入口和搜索 Skill。原目录清单另有1个缺失项，未凭空补成“全量无缺失”。安装器 `--check` 返回零漂移；未覆盖本机双语向量、常驻服务、提示词或其他工作区修改。

修复旧路由器的搜索候选接线后，两条自然搜索请求首选新工具，首选条件执行指引出现；热态重复路由分别64/66毫秒。随后13项通用路由检查为8/13：本轮两条搜索正例通过（87/127毫秒），Git提交仍首选交付 Skill。其余失败是已有全局路由的前端首选、任务树首选顺序，以及三条闲聊误推荐；未改这些策略，也没有把整套推荐器冒称全部通过。

图更新时出现过两次后台构建和已有 worker 的首次加载/热更新超时（55秒），之后热态恢复。新问题的首次路由也可达到秒级；本轮没有证明冷启动稳定快速、未做后台索引去重或修复所有通用路由。搜索 MCP 本体的3.403秒实测与这些 Hook/图更新时间分开记录。

macOS 完整安装/任意工作区快速操作/稳定源/检查/回滚回归通过；治理校验、23个 Skill 包校验及15项PR质量门禁通过。Skill 的结构验证不等于模型在任意自然任务中都一定自动调用；未额外付费启动模型行为实验。Skill 要求和实际 MCP 可用范围仍以当前会话为准。

测试入口：`scripts/test-complementary-search.mjs`、`scripts/test-technical-research.mjs`、`scripts/test-technical-research-mcp.mjs`、`scripts/test-capability-adoption.mjs`。CI 增加 macOS/Windows 的搜索边界测试；CI 定义本身不等于对应平台已经实机通过。
