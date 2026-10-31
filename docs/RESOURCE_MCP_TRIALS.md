# 统一资源库 MCP 盘点与真实调用

测试日期：2026-10-24。输入为统一资源库的 `审计/mcp.json`，输出为 `.reports/resource-integration/mcp-audit.json`。这是连接定义、工具发现及小样本调用证据，不是 478 个服务全部可用的证明。

## 全量机器盘点

| 项目 | 实测数量 |
|---|---:|
| 连接定义 | 478 |
| HTTP / stdio | 438 / 40 |
| 英文描述，尚需中文检索试验 | 409 |
| 含中文描述，尚需检索试验 | 44 |
| 缺描述 | 12 |
| 与其他 MCP 共用整插件描述 | 13 |
| 发现凭据字段绑定 | 16 |
| 显式宿主绑定线索 | 7 |

这些描述来自最近的插件 manifest；没有读取源 `.mcp.json` 的凭据值。单个 manifest 可以覆盖多个服务，不能将 OMC 的“多代理编排、深度研究”整包描述当成 Context7 或 grep.app 的准确能力描述。英文描述占多数也不能单凭静态检查判断中文召回通过，必须与现用多语检索一起测。

源 manifest 许可字段：466 unknown、8 MIT，其余是 GPL-3.0-only、MIT WITH Commons-Clause、UNLICENSED、未声明各 1。该字段是插件声明，不等于远程服务许可、使用条款或免费证明；本轮没有复制第三方实现。

## 完整协议发现

对原审计中已有初始化成功证据、无凭据绑定、无占位符、无 URL query/userinfo 的 48 个 HTTP 服务进行发现，最大并发 12，每请求超时 15 秒。实际顺序为 `initialize → notifications/initialized → tools/list`，支持分页。其余 430 项未运行本轮发现，包括全部 40 个 stdio 定义；没有为了发现工具而安装或执行来源未知的包。

42 个服务成功列出合计 1,962 个工具；6 个失败：

| 服务 | 首个实际失败 |
|---|---|
| chinacscs-data | `tools/list` 返回“未提供有效的 MCP Key” |
| zocf-ai-tools | `tools/list` 返回“未出示密钥” |
| wintalent-ats-mcp | 初始化后的请求返回 HTTP 401 |
| jiuliang-198-health | 初始化后的请求返回 HTTP 401 |
| joyread-english | 连接失败 |
| connector-workshop | 连接失败 |

初次完整脚本运行（包含前两个业务试验）约 17.1 秒。这不是延迟分布或高并发压测。发现工具没有证明工具真实业务可用；初始化成功尤其不能证明认证已完成。

## 匿名只读业务试用

仅对公开代码/文档检索做试用，没有付费账号、API key、源凭据、私有文件或业务写操作。匿名可用不保证服务以后价格与额度不变。其他服务成本仍标 unknown，没有批量执行它们的业务工具。

| 服务 / 工具 | 输入与判断 | 结果 | 业务调用 / 完整冷会话 |
|---|---|---|---|
| Context7 / resolve-library-id | React 官方 useState 文档库；要求返回 React 及库 ID | 两次通过，返回 `/reactjs/react.dev` 等候选 | 1.89s / 3.48s；1.64s / 3.28s |
| Context7 / query-docs | `/reactjs/react.dev`；如何声明计数器并用前值 updater 更新 | 通过，返回 useState/updater 文档与代码 | 1.18s / 1.88s |
| grep.app / searchGitHub | `useState(`，过滤 `facebook/react`，先 TypeScript 再 JavaScript | 两次均空结果，语义断言失败；不能报业务成功 | 0.63s / 2.14s；0.59s / 2.17s |
| grep.app / searchGitHub | 同一 literal query 去掉仓库和语言过滤 | 两次通过，返回含仓库、文件路径、代码片段的多个结果 | 0.74s / 2.40s；1.07s / 2.84s |

过滤为空并不能单独判定服务故障；它揭示了调用参数、索引覆盖和实际仓库名称会影响检索质量。应先查真实代码模式，再按已确认的仓库逐步缩窄，而不是把中文问题原文直接当 literal query。所有负例保留在机器报告中；7 次持久记录中 5 次符合各自语义断言，不能将此数字当通用准确率。另有一次无过滤人工复查也返回了代码，但未计入 7 条持久记录。

返回体大小与 SHA-256 保存在报告中；业务输出不是 LLM token 消耗。本轮没有调用模型，也没有声称测过端到端 agent 准确率或 token 改善。

## 入图建议与运行边界

所有连接可以作为带状态的服务目录节点入图。其 `kind=mcp_server`、稳定 ID、来源引用、原描述、传输、依赖和成本状态与“可以执行”分开。1,962 个已发现工具可另外建立工具节点，保留原 description、inputSchema 和 annotations，使用 `tool → server` 关系。工具描述比共享插件说明更具体，中文检索词作为独立检索字段添加，不能改写工具的实际语义。

专家模块保持完整，以 `expert_module → required_tool → mcp_server` 表达依赖。路由命中专家后检查它所需的工具、权限和运行环境；缺依赖时报告阻塞，不能用“已经进入索引”冒充专家已经可执行。不要在每轮同时连接 478 个服务，也不要将全部 schema 注入上下文。

全局常驻进程可以保存工具目录与按认证主体隔离的会话池。服务端是否支持同会话并发必须单独确认；不要跨账号共享 session ID。未知费用服务不能因为 tools/list 成功就自动执行业务；工具的只读 annotations 也不能单独当作可信授权依据。

## 可复用运行模块与验证

`scripts/resource-mcp-runtime.mjs` 导出 `createMcpHttpClient`，提供 initialize、listTools、callTool、close 和脱敏 trace。支持 SSE / JSON、session header、分页、超时、响应大小限制，拒绝不匹配的响应及分页循环，不自动重试业务调用。持续 SSE 在匹配结果到达后结束本次响应，不等待服务器关闭整个流。它只实现传输，权限、费用及业务参数 schema 验证由上层路由负责。

`scripts/resource-mcp-cli.mjs` 从 `~/.codex/skill-registry/resource-modules.json` 读取精确 module ID，提供 describe、list-tools、call；不接受临时任意 URL、不读 source_definition，不猜凭据。调用默认限于已验证的 Context7 / grep.app 公开只读工具，其他工具须有只读标记且费用已知；未知副作用、认证未配置和未知费用业务调用会明确失败，无额外交互弹窗。调用者仅在当前任务已有真实授权时才可传 `--authorize-effects` / `--authorize-cost`；这些标志不提供凭据，也不从命中检索或工具自述推断用户授权。本轮只用 mock 验证覆盖标志，没有运行真实付费或写业务。参数检查包括必需字段与未知属性，不是完整 JSON Schema 校验器。输出 `protocolSucceeded` 只指 MCP 未返回 isError，不等于业务结果正确；grep.app 的空结果即反例。

本轮已运行持久测试 `node scripts/test-resource-mcp.mjs`：初始化顺序、并发 initialize 合并、SSE、session header、两页工具发现、真实请求形状、HTTP 401、JSON-RPC 错误、分页循环、不匹配 ID、userinfo 拒绝、响应大小、超时、持续 SSE 提前结束，以及 CLI 的认证、费用、只读、参数和精确 ID 门禁；均通过。公开服务试验也已使用此传输模块。仓库未提供 Skill 中提到的 `scripts/verify-repository.ps1`，本机也未找到 pwsh，因此没有声称全仓 PowerShell 验证通过。

复现静态盘点：`node scripts/audit-resource-mcp.mjs`。复现协议与匿名只读试验：`node --use-env-proxy scripts/audit-resource-mcp.mjs --probe`。仅追加指定服务试验、保留既有发现与负例：`node --use-env-proxy scripts/audit-resource-mcp.mjs --probe --trials-only --server grep_app`。可用 `--source` 指定同格式资源审计目录，`--output` 指定报告文件。
