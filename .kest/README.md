# Kest Flow

安装 Kest 后运行：

```bash
kest run .kest/flow/governance-smoke.flow.md
```

该示例只证明 Flow 机制和上游公开资产可达。下游项目应替换为自身 API 的注册、认证、核心业务与失败路径。

调研时使用从 `upstreams/kest` commit `bf73f655c1b7cabc106244605cded9e2dd326ffa` 本地构建的 CLI；该上游版本的许可证文件尚未核验，因此二进制只存放在被忽略的 `.tools/`，不随模板分发。

`scripts/test-kest-flow-contract.ps1` 在 CI 中验证 step、capture、assert、edge、HTTPS 和 JSON/JUnit 报告契约。需要真实 HTTP 证据时，设置 `KEST_BIN` 并运行 `scripts/run-kest-flow.ps1`；它会写入被忽略的 JSON/JUnit 报告，不把 CLI 或日志提交到模板。2026-08-18 本机实际运行固定 CLI：2 个 step 均返回 200，总请求时间约 1.067 秒。
