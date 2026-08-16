# Findings 优先级与闭环

Finding 是一个已经有证据的、可执行的质量问题，不是泛泛建议。相同门禁重复失败使用同一 `fingerprint`，从而更新原问题，而不是不断制造重复项。

## 优先级

- `P0`：秘密泄漏、可利用安全问题、数据破坏或系统不可用；立即阻止 PR 和发布。
- `P1`：核心用户旅程、公共契约或发布证据发生重大回归；阻止发布，默认阻止 PR。
- `P2`：有明确影响但存在绕行方案；进入近期排期，不默认阻止 PR。
- `P3`：体验、清晰度或维护性改进；纳入正常优化队列。

优先级描述影响，不描述修复难度。一个很容易修的秘密泄漏仍是 `P0`。

## 生命周期

人工处理路径为 `open → in_progress → resolved → testing → closed`。验证失败时从 `testing` 进入 `reopened`，再进入 `in_progress` 或 `resolved`。自动聚合器发现同一已解决问题再次失败时会直接标记为 `reopened`；门禁首次恢复时标为 `resolved`，仍需独立验证后才能关闭。

## 必需证据

每条 Finding 必须包含稳定 ID 和 fingerprint、优先级、类别、门禁、标题、失败证据、修复方向、责任人、首次与最近发现时间以及状态。若行为来自产品需求，还应关联 `US-nnn` 和 `AC-nnn`；若进入协作队列，应记录 GitHub Issue URL。

`quality/findings.json` 是人工确认过的基线；CI 报告经 `scripts/collect-findings.ps1` 聚合到 `.reports/findings.json`。`scripts/set-finding-status.ps1` 只允许合法状态转换。外部 GitHub 写入默认是 dry-run，只有显式 `-Apply` 才创建或更新 Issue。
