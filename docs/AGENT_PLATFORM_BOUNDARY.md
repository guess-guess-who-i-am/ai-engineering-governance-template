# Agent 平台边界

本仓库是工程治理模板，不是 Agent 运行平台。它拥有规则路由、Skills、需求追踪、质量门禁、Findings、设计参考和 GitHub 协作契约。

ZGI 一类完整平台还拥有 Agent Studio、工作流执行器、模型与供应商路由、知识库、Skills 沙箱、发布、运行日志和批量评测。这些能力涉及独立的运行时、安全隔离、数据生命周期、可观测性和部署架构，应建立单独仓库。

需要接入完整平台时：

1. 本模板继续拥有用户故事、公共契约和验收证据。
2. 平台仓库拥有执行运行时、模型凭据引用、租户与数据隔离。
3. 两者通过版本化 API、事件或发布包连接，并由 contract 与 E2E Flow 验证。
4. 不把 ZGI Community License 源码复制到 MIT 模板，也不把 `x.ai` 的 DESIGN.md 误称为 ZGI 设计。

参考产品：[ZGI](https://zgi.ai)；参考源码：[zgiai/zgi](https://github.com/zgiai/zgi)。采用前必须单独复核当前许可证、部署说明和安全边界。
