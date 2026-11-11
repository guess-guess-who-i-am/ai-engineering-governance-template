# GitHub、Stack Overflow 与论文搜索修复

2026-11-11。目标是区分连接失败、查询不命中、来源覆盖不足和结果误报，再验证用户级 MCP 实际可用。

## 根因与修复

| 环节 | 实测偏差 | 本次处理 |
|---|---|---|
| 网页互补 | 固定连接工作区 IDE 的 5505 端口；该端口已无监听，真实搜索 daemon 在 3210 | 直接调用用户级 Open-WebSearch `/status`、`/search`，解除工作区 IDE 端口依赖 |
| GitHub 查询 | 默认 repository search 未搜索 README；原长查询 HTTP 200、零命中 | 默认增加 `in:name,description,readme`；保留显式 `in:`；同时返回原始 `query` 和实际 `requestQuery` |
| Stack Overflow 查询 | 简单查询有结果；长的 MCP 查询在 API 与网页均为空 | 空结果明确标记 `empty`，提示用短的 `apiQuery`；保留原问题，不擅自删除关键词 |
| 论文覆盖 | Crossref 的相似标题不是目标 Transformer 论文；原网页分支断连 | 修通 Crossref 与网页并行互补；已知目标优先展示；预印本/覆盖缺口可另加 `source: openalex`，保留免费额度错误 |
| 成功统计 | HTTP 200 空数组也计入 `successfulOperations` | 分开统计命中、空结果与完成请求；全空返回 `empty`，不误报工具故障或发现成功 |
| 引擎配额 | daemon 会把 `limit` 分给多个引擎 | 每引擎给足配额，再交错、去重，按调用方 `topK` 截取 |

网页只请求明确免费的 DuckDuckGo/Bing。先检查 daemon 允许的引擎，拒绝将不允许的引擎悄悄替换成默认供应商。查询并发有界，共享截止时间；一个失败不抹去已完成的其他查询。`cacheMode: only` 不联网，旧协议缓存通过新键隔离。

## 实际验收

- 修复前新增的 11 项回归中，9 项失败、2 项通过；修复后包含免费引擎限制的 13 项全部通过。
- 全局安装目录的真实 stdio MCP 入口：9 项查询一批，8,545 ms；请求时间区间有真实重叠，观测到 9 个并发 HTTP 区间（不含 daemon 内部引擎请求）。
- GitHub 原长查询由零命中变为报告 90 个仓库，返回前 5 项；第一项是 `modelcontextprotocol/rust-sdk`。这只证明候选发现恢复，不证明每个仓库实现了所需机制。
- `ripgrep` 命中官方仓库；Stack Overflow 命中 `if/else in a list comprehension`；Transformer 命中 arXiv `1706.03762`；OpenAlex 命中《The Tail at Scale》DOI `10.1145/2408776.2408794`。中文网页有候选；没有把数量当成准确率。
- 不存在的目标保持未命中；原长 Stack Overflow 查询仍为空，没有伪造成功。
- 复核后的全局入口再验用时 8,412 ms；API-only 工具从仅缓存读取到空结果，正确返回 `empty`、零成功发现且 `isError: false`。同一实际查询对应不同原始输入时，各自的查询身份也保持完整。

原始证据保存在运行机器 `.reports/search-repair-20261111/`：`before.tap`、`live-local.json`、`live-global.json`、`live-global-final.json`、`proxy-comparison.json`、`bing-exact-trace.json`、`deployment.json`。API 原始响应及每次查询的 artifact 路径由报告返回，未作为机器配置上传。

## 网络边界与尚未验证的部分

常驻 daemon 开启代理时，部分 Bing 查询报 `Bing exceeded the regional redirect limit (1)`；独立直连进程的相同论文查询能正确返回。禁用整个 daemon 的代理后，DuckDuckGo 超时，说明不能用全局关代理修复 Bing。保留原代理设置，Bing 失败通过 `failures` 和 `partial` 报告；本次没有修改第三方引擎代码，也没有声称 Bing 全部修复。

搜索候选、README 检索和网页摘要不等于源码、accepted answer 或论文全文。Stack Overflow 原网页可能返回 403，但官方 StackExchange API 的答案正文可读，已实际读取 accepted answer `74368828`、`76554695`。该搜索 MCP 尚无通用正文读取工具；需要通过官方 API 或独立正文读取工具继续取证。付费、验证码或权限边界没有绕过。

本次已将三个搜索实现文件部署到用户级 `~/.codex/tools/complementary-search/scripts/` 并备份原文件，新连接实测通过。**已经运行的 MCP 进程仍持有旧模块，需要在客户端重新连接 `technical_research` 或重启客户端后加载新实现。** 没有停止其他聊天，也没有宣称跨电脑或重启后的 daemon 启动已验收。

本机没有 `pwsh`，因此未运行 PowerShell 全仓门禁；Skill 提及的 `scripts/verify-repository.ps1`、`scripts/new-debug-record.ps1` 及资源登记文档在当前树不存在，不作为已执行证据。

## 复测与使用

先在仓库执行 `npm ci --ignore-scripts`，再运行：

```sh
npm run test:research-search
npm run test:research-search:live
```

后者会访问真实免费来源；断网、限流和上游内容变化可能使其失败。测试通过 SDK 连接实际 MCP 入口，并保存原始响应。也可指定全局入口与报告路径：

```sh
node scripts/test-research-search-live.mjs "$HOME/.codex/tools/complementary-search/scripts/technical-research-mcp.mjs" .reports/search-live-global.json
```

混合检索使用 `complementary_search_batch`；`technical_research_batch` 仅访问 API。自然语言长问题应显式提供源适配的短 `apiQuery`；已知目标提供 `expectedUrl` 或 `expectedTitle`。`CODEX_SEARCH_WEB_BASE_URL` 如需设置，必须是 Open-WebSearch daemon 的 loopback origin，不能再指向 IDE 的 `/api/web-search` 协议。

## 决策依据

- [GitHub 官方 repository search 范围](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)：省略 `in:` 时仅 name、description、topics；README 需要明确范围。
- [StackExchange advanced search 官方契约](https://api.stackexchange.com/docs/advanced-search)：`q` 是未公开算法的自由文本搜索；不能武断解释为严格 AND。
- [SO 关于 README 搜索的讨论](https://stackoverflow.com/questions/76554338/)：accepted answer 建议 `in:readme`，与官方文档一致。
- [另一 SO 讨论](https://stackoverflow.com/questions/74363221/)的 accepted answer 对默认 README 范围的说法与当前官方文档冲突；采用官方契约，并用同一查询实测确认。

这是检索范围与接口协议问题，以官方契约、源码和控制变量实测作判断；没有用不相干的论文替代工程证据。
