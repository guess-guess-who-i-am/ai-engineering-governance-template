---
id: US-007
status: verified
risk: high
---

# US-007: 检测但不自动吸收上游变化

## 用户故事

- Actor: 治理模板维护者
- Need: 知道研究来源何时超出已审查 commit
- Value: 更新不会绕过许可证、行为差异和消费者影响审查

## 验收条件

### AC-001: 固定版本无漂移

- Type: happy
- Given: lock commit 与远端默认分支一致
- When: 周任务检查全部上游
- Then: 生成结构化 current 报告且门禁通过

### AC-002: 远端前进时阻断并保留比较证据

- Type: failure
- Given: 任一远端分支出现 lock 之外的新 commit
- When: 使用 FailOnDrift 检查
- Then: 报告列出 pinned 与 remote commit 并使任务失败，不修改 lock 或本地源码

## 证据映射

- AC-001: file=scripts/test-upstream-drift.ps1; gate=upstream-drift
- AC-002: file=scripts/test-upstream-drift.ps1; gate=upstream-drift

## 非目标

- 不自动合并、复制或重新分发上游变化。
