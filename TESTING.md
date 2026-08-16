# 测试与质量证据体系

本仓库把测试理解为一条从用户意图到可重复证据的链，而不是几个零散命令。所有新项目都继承完整测试类别；暂时不能运行的类别必须登记为 `planned`，发布检查会失败，不能通过“没有测试文件”获得绿色结果。

## 1. 从用户故事开始

用户故事回答三件事：谁需要什么、为什么有价值、什么现象才算完成。文件位于 `requirements/user-stories/`，每个故事使用稳定的 `US-nnn`，每条验收条件使用故事内稳定的 `AC-nnn`。

验收条件采用 Given / When / Then：

- `Given` 冻结可重复建立的前置状态。
- `When` 只描述用户或系统执行的动作。
- `Then` 描述外部可观察、可证伪的结果，不写实现细节。
- `Type` 区分主路径、失败、边界、安全、性能和可访问性证据。

`证据映射` 把 AC 映射到真实测试文件。故事只有在所有映射文件存在且没有 `planned` 占位时才能标记为 `verified`。`scripts/validate-user-stories.ps1` 机械执行这些规则。

用户故事不是测试代码。它负责定义行为和验收边界；单元、集成、契约、E2E 或 Flow 测试负责证明这些边界。一个故事通常由多层测试共同证明，不追求一条故事只对应一个大而脆弱的端到端测试。

## 2. 必须显式决策的测试类别

`quality/gates.json` 是测试覆盖清单。下面每一类都必须出现，并标为：

- `active`：有可运行命令和执行 profile。
- `planned`：技术栈已经需要它，但尚未配置；必须设置 `requiredBeforeRelease=true`。
- `not-applicable`：项目确实没有该表面，并给出具体理由。

必需类别包括需求追踪、治理、功能、单元、集成、契约、E2E、可访问性、性能、安全、依赖安全、容器安全、兼容性、部署、定性质量和数据质量。新增技术栈不能删除类别，只能改变它的明确决策。

## 3. 测试层如何分工

功能测试不是单一工具：

1. 单元测试证明纯规则、状态变换和错误分支。
2. 集成测试证明数据库、文件系统、队列、外部适配器等真实边界。
3. 契约测试证明生产者、消费者、Schema、错误语义和兼容性同步。
4. E2E / Kest Flow 证明用户或系统旅程从入口穿过真实边界。
5. 部署 smoke 证明构建产物在目标运行方式中真正启动并保持关键安全策略。

测试应选择能复现风险的最低稳定层。不能用编译代替行为测试，也不能用全 Mock 单元测试证明数据库、浏览器或部署行为。

## 4. 性能证据

性能分为四层，不能混称：

- 确定性预算：前端 bundle、资源数量、二进制体积等，适合 PR 门禁。
- 微基准：热点函数、队列、缓存、序列化等；固定环境，多次运行并比较基线。
- API 时延与负载：Kest 的 `duration < N` 只证明单请求时延；并发、吞吐、P95/P99 和稳定性需要 k6、vegeta、wrk 等负载工具。
- 真实用户指标：LCP、INP、CLS 只有生产 RUM 的 p75 才能称为真实用户表现；本地 Lighthouse 只能作为可比较的实验室证据。

任何阈值都必须记录指标、环境、数据规模、基线来源和修改程序。至少三次可比较的实验室运行报告中位数；不能提高预算只为让 CI 变绿。

## 5. 安全与供应链

安全门禁至少考虑：

- secret scan：阻止 token、API key 和私钥进入历史。
- SAST / CodeQL：检查语言级危险数据流和已知缺陷模式。
- 依赖扫描：从锁文件生成 CycloneDX SBOM，使用 OSV 等漏洞数据源。
- 容器扫描：对最终运行镜像做 Trivy 漏洞、secret、EOL 基础系统检查；源码依赖扫描不能替代它。
- 身份与权限：认证、授权、租户隔离、API key scope、私有缓存、Cookie、CORS 和错误泄漏必须有失败路径测试。
- 敏感遥测：日志、trace、指标和错误报告不得保存 token、密码或隐私数据。
- CI 供应链：外部 Action 固定完整 commit SHA，最小权限，checkout 不持久化凭据，禁止用 `pull_request_target` 执行不可信 PR 代码。

当前模板能真实执行 secret scan 和 GitHub Actions 供应链检查。依赖与容器门禁只有项目出现锁文件或镜像后才能启用，但生成项目会把它们标为发布前必需的 `planned`，不会静默遗漏。

## 6. 可访问性、兼容性和数据质量

UI 项目至少组合静态 a11y lint、组件角色/标签测试、键盘导航、焦点管理、对比度、reduced motion 和真实浏览器 E2E。自动工具不能证明全部 WCAG，但能守住高频回归。

兼容性矩阵只覆盖项目承诺支持的运行时、数据库、浏览器或操作系统。矩阵版本必须有维护窗口；不为展示而测试无人支持的版本。

研究和数据项目还要验证输入 Schema、缺失值、单位、数据泄漏、随机种子、环境锁定、基线复现和统计假设。结果文件存在不等于实验可复现。

## 7. CI profiles

- `pr`：快速、确定性的需求、治理、功能和安全基线。
- `release`：先检查是否仍有发布必需的 `planned` 门禁，再运行全部发布证据。
- `nightly`：网络依赖的漏洞数据、长时间或环境型检查。
- `performance`：受控环境中的基准、负载和 bundle 证据。
- `qualitative`：机械门禁通过后，由校准过的大模型检查清晰度、意图和可信表达。

定性门禁分成两层。`qualitative-adapter-contract` 在 PR 和 release 中使用本地模拟 Responses API，验证鉴权头、请求结构、严格 JSON Schema、空模型字段省略、结果解析、校准样例和缺少 API key 的失败路径；它不调用外部模型。真实 `llm-qualitative` profile 只有在 GitHub 仓库变量 `LLM_GATE_ENABLED=true` 后才随相关 PR/push 自动运行，手动触发不受该变量限制，但仍严格要求 `LLM_BASE_URL` 和 `LLM_API_KEY` Secrets。可选 `LLM_MODEL` 留空时由网关选择默认模型。

运行方式：

```powershell
./scripts/check.ps1
./scripts/invoke-quality-gates.ps1 -Profile release
./scripts/invoke-quality-gates.ps1 -Profile nightly
./scripts/invoke-quality-gates.ps1 -Profile performance
```

报告写入 `.reports/quality/`。CI 应上传报告，即使门禁失败也保留诊断证据。

公开 GitHub 仓库使用 `scripts/configure-github-repository.ps1 -Apply` 建立远程治理：默认分支必须经 PR，`validate` 是严格 required check，管理员同样受保护，禁止强推和删除，要求线性历史与对话解决；同时启用 secret scanning、push protection、Dependabot 安全更新、私密漏洞报告、auto-merge 和合并后删分支。省略 `-Apply` 时脚本只审计当前远程状态。

## 8. 上游方法如何被吸收

- LUAS：分层 CI、OpenAPI breaking gate、Go/Node/数据库矩阵、race detector、bundle 预算、Lighthouse 证据规则、OSV、SBOM、Trivy、容器 smoke 和 Action SHA 固定。
- Kest：Markdown-native API Flow、捕获、跨步骤变量、状态/正文/响应头/时延断言和 JSON/JUnit 报告。Kest 适合作为业务 Flow 层，不替代语言原生测试或并发负载工具。
- Taste Skill、Apple Design Skill、DESIGN.md：提供响应式、可访问性、reduced motion、真实设备和逐帧审查方法；这些要求需要映射到自动检查与人工/定性证据，不能只停留在提示词。

本仓库没有从 Kest 复制源码。其固定版本许可证文件仍不明确，因此这里只采用可互操作的 `.flow.md` 思想和可选工具接入方式。
