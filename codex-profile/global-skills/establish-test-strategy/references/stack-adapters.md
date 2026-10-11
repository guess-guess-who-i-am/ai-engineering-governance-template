# 技术栈测试适配器

## 目录

1. Go/API
2. Node/Web
3. HTTP contracts 与 Flow
4. Python/数据研究
5. 容器与部署

## 1. Go/API

- PR：`go build`、`golangci-lint`、聚焦 `go test`。
- 集成：使用一次性真实 PostgreSQL schema/database，验证 migration、transaction、locking 和 repository。
- 并发：只对并发关键包运行 `go test -race`，发布边界再扩大。
- 性能：`go test -bench ... -benchmem -count=5`；保留环境与可比较基线。
- 兼容性：只矩阵测试承诺支持的 Go、PostgreSQL 和操作系统版本。

## 2. Node/Web

- PR：精确包管理器版本、冻结 lockfile、type-check、lint、Vitest/Testing Library。
- UI：通过 role、name、label 和用户事件测试；加入 jsx-a11y、对比度和 reduced-motion 检查。
- E2E：Playwright/Cypress 覆盖少量关键旅程、失败与权限路径。
- 构建：生产构建、静态输出/服务端边界、source map 和 route/bundle 预算。
- 性能：三次以上可比较 Lighthouse 报告中位数；生产 RUM 单独治理。

## 3. HTTP contracts 与 Flow

- OpenAPI lint 和 Schema 校验。
- 从契约生成类型，并检查提交产物无漂移。
- 使用 `oasdiff` 一类工具阻止未授权 breaking change。
- 同时测试生产者、消费者、错误 envelope、状态码和稳定机器字段。
- 用 Kest `.flow.md` 表达登录、创建、读取、撤销等跨步骤旅程；捕获 ID/token，断言状态、正文、响应头和必要时的单请求时延。
- 并发吞吐与 P95/P99 使用 k6、vegeta 或 wrk，不用 Kest 单请求时延代替。

## 4. Python/数据研究

- 单元：pytest 覆盖变换、指标和失败输入。
- 数据契约：Pandera/Great Expectations 或明确 Schema 检查列、类型、范围、缺失和单位。
- 可复现：锁定环境、随机种子、数据版本、训练/验证切分和硬件条件。
- 科学证据：复现基线，保存参数、日志和结果；统计测试必须检查适用假设。
- 性能：pytest-benchmark 或独立基准，避免把一次计时当稳定结论。

## 5. 容器与部署

- 使用 immutable base image digest，并构建一次、复用同一镜像完成 smoke/Compose。
- 对最终镜像生成 CycloneDX SBOM，使用 Trivy 检查 HIGH/CRITICAL、secret 和 EOL。
- 验证非 root、健康检查、最小运行文件、启动/停止和关键响应头。
- 发布时附加 registry provenance、SBOM attestation 和组织管理的签名身份。
