# 官方技术检索：全局安装、认证与额度

2026-11-11。当前采用 GitHub、Stack Exchange、OpenAlex、Crossref 的官方在线 API，不建立本地文献/网页语料库，不使用付费服务，不再自动抓取 DuckDuckGo/Bing。请求缓存与诊断证据仍保存在用户目录，默认仅复用五分钟内的请求结果；这不是本地搜索数据库。

## 现在能用什么

| 来源 | 本机认证与实测 | 额度边界 |
|---|---|---|
| GitHub 仓库 | 从现有官方 `gh` 登录私下读取凭据，命中 ripgrep | 本次官方响应为 30 次仓库搜索/分钟；不能用 core 的 5000/小时替代 |
| Stack Overflow | 未注册账号，匿名官方 API 命中已知问题 | 本次为 300 次/日、剩余 257；共享 IP 与其他调用可能改变剩余额度 |
| OpenAlex | 未注册账号，本次匿名请求命中 Tail at Scale | 本次响应预算 1000 credits，搜索消耗 10，剩余 910；并非 1000 次搜索 |
| Crossref | 无需账号，标题搜索命中 Tail at Scale | 保留官方限流和错误；不承诺无限请求 |

全局真实 MCP 四来源请求在 4832 ms 内全部命中目标。只证明本次接口和目标可用，不证明任意查询相关、论文全文可读或永久免费额度永远足够。OpenAlex 的匿名策略可能改变；不能把匿名可用描述成已接入注册密钥。

`complementary_search_batch` 和 `technical_research_batch` 均只访问官方 API。前者保留原问题、支持短 `apiQuery` 与目标核对；`papers` 指 Crossref 标题搜索。OpenAlex 需单独选择。Crossref 不覆盖全部预印本，标题检索也不是作者/完整引文检索。通用网页与新闻没有配置免费的官方搜索接口，`source: web` 已移除，不会用抓取或付费服务替代。

## 为什么此前不稳定

1. 官方 API 请求未读取已存在的 GitHub 登录，只能消耗匿名额度；现在复用 `gh`，不复制 token 到文件。
2. 仅限制同时连接数不能限制每分钟请求数。全工作区共享常驻服务、来源并发、请求合并、冷却状态；GitHub 认证/匿名请求间隔分别至少约 2050/6050 ms，仍服从服务器实际额度与退避。
3. GitHub 的 reset 为时间戳，OpenAlex 的 reset 为距离重置的秒数。此前通用解析错误；现在分来源处理。Stack Exchange 没有提供 reset 时不伪造时间，只给出下一次允许复查的时间。
4. Crossref `query.bibliographic` 在本次已知标题检索中返回相似文献，前五项无目标；相同标题用 `query.title` 命中第一项。现按论文标题检索，不把 HTTP 200 或非空误认为目标成功。
5. 自动网页补搜增加验证码、抓取协议与引擎变化的失败边界，已从该检索入口删除。task-tree 自有的独立网页能力不在本次所有权内。

额度不足或本轮时限不足时返回 `quota`、`retryAt`、错误码，并保留其他来源的成功结果。不能保证 100 个不同的外部查询同时立即成功；100 个相同查询可以合并一次上游请求，这与突破官方额度不同。

## 账号与凭据

当前四来源均已有真实请求证据，不必先注册两个账号才能使用。需要增加官方额度时：

- [Stack Overflow 免费注册](https://stackoverflow.com/users/signup)，然后按 [Stack Exchange 认证说明](https://api.stackexchange.com/docs/authentication)申请官方 API 凭据。账号本身不等于已签发应用密钥。
- 在 [OpenAlex 官方网站](https://openalex.org)注册免费账号，参考 [官方认证说明](https://help.openalex.org/api/authentication/)获取免费 API key。不要启用付费购买。

凭据不要发到聊天、写进仓库、日志或 URL。macOS 可用“钥匙串访问”添加密码项目：项目名分别为 `com.codex.research.stackoverflow`、`com.codex.research.openalex`，账户填当前 macOS 登录用户名，密码栏填官方凭据。服务只读取这两个确切项目，并每分钟重新检查一次。Keychain 访问若弹出系统授权，应由用户自行处理。无钥匙串项目时保留匿名状态和实际额度，不伪报认证成功。

直接启动服务时也可从环境读取 `GH_TOKEN`/`GITHUB_TOKEN`、`STACKEXCHANGE_ACCESS_TOKEN`/`STACKEXCHANGE_KEY`、`OPENALEX_API_KEY`；终端环境不会自动传给登录启动的 LaunchAgent，长期使用优先钥匙串。所有认证均放 `Authorization: Bearer` 请求头；禁跟随重定向，拒绝向非官方来源发凭据，并对可能反射凭据的响应/错误脱敏。

## 日常使用和迁移

继续使用已有“部署 Codex 全局配置”右键入口。它安装用户级服务及代码，不要求每个工作区运行脚本。部署源已纳入认证模块、官方 API 工具说明和全局 `parallel-web-research` Skill。新电脑须满足 README 安装条件，并自行完成 GitHub 官方登录及可选账号凭据配置；登录态和密钥不随 Git 迁移。

`com.codex.research` 在 `127.0.0.1:3211` 提供共享服务，由 LaunchAgent 的 `RunAtLoad`/`KeepAlive` 管理。原专用抓取服务 `com.codex.research-web` 已退役。SDK 使用固定 1.32.1，优先链接全局 task-tree runtime，不再要求 Open-WebSearch。旧版直连 API 的 MCP 进程需要重新连接一次；当前适配器可在服务恢复后沿用原连接。

开发诊断命令（用户日常无需执行）：

```sh
npm run test:research-search
npm run test:research-search:live
node scripts/install-research-services-mac.mjs --check --json
```

安装器备份受管文件并检查代码、MCP 注册、SDK 链接、LaunchAgent 和运行版本。`--home` 指向其他用户时只落盘；`--no-start` 不启动服务。只恢复安装文件无需注册账号。

## 验证与边界

- 全量全局图已重建，4个常驻查询进程中英文通道预热通过；真实socket检索返回新版官方API工具说明和全局Skill。全量重建是发布时的一次性编码，不是每次搜索都做。
- 26 项隔离回归通过：官方路由、凭据隔离/反射脱敏、跨批次节流、配额与 reset、非 JSON 限流、同查询合并、独立截止时间、部分失败、无抓取依赖的安装与漂移检查、MCP 恢复。
- 真实 MCP 四来源目标均命中，认证与实际额度见 `.reports/search-official-20261111/live.json`；首次 Crossref 未命中的结果保留为 `live-before-crossref-fix.json`。
- macOS 全新安装、右键部署源、幂等更新及回滚隔离测试通过；使用受控 MCP fixture，不冒充跨电脑实装。
- 本轮五个独立 MCP 进程的100次相同查询全部成功，1.644秒且只发出一次上游请求；强退后原MCP连接约178ms恢复。证据在 `.reports/search-official-20261111/recovery-live.json`；不能替代100种不同查询的外部额度验收。
- 硬重启、其他电脑、注册后的 Stack Exchange/OpenAlex 密钥尚未实测。本机没有 `pwsh`，PowerShell 全仓与 Skill 门禁未运行；缺失的 `scripts/verify-repository.ps1`、`docs/RESOURCE_REGISTRY.md` 不作为通过证据。
- Stack Apps 补充认证帮助页触发验证码；OpenAlex 帮助页本轮读取不完整。认证机制依据可访问的 Stack Exchange 官方 API 文档、先前已读取的 OpenAlex 官方说明及本轮响应；未假装完成这两个账号的认证验收。

官方依据：[GitHub 搜索限流](https://docs.github.com/en/rest/search/search)、[GitHub REST 限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[Stack Exchange 节流](https://api.stackexchange.com/docs/throttle)、[Crossref REST 建议](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/)。
