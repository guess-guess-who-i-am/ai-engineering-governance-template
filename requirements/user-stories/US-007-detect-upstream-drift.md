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

## 测试设计重点

- 主成功路径: AC-001: 固定 commit 与远端一致时生成 current 报告
- 重要失败与恢复: AC-002: 远端前进时保留比较证据并使门禁失败
- 变更影响面: 直接回归 pinned/remote 比较和报告；相邻检查多来源、重复运行、网络失败，以及 lock、本地源码和镜像保持不变

## 非目标

- 不自动合并、复制或重新分发上游变化。
