# Kest Flow

安装 Kest 后运行：

```bash
kest run .kest/flow/governance-smoke.flow.md
```

该示例只证明 Flow 机制和上游公开资产可达。下游项目应替换为自身 API 的注册、认证、核心业务与失败路径。

调研时使用从 `upstreams/kest` commit `bf73f655c1b7cabc106244605cded9e2dd326ffa` 本地构建的 CLI；该上游版本的许可证文件尚未核验，因此二进制只存放在被忽略的 `.tools/`，不随模板分发。
