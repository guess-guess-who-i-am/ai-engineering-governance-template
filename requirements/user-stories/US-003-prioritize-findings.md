---
id: US-003
status: verified
risk: high
---

# US-003: 按优先级闭环质量问题

## 用户故事

- Actor: 维护公开工程模板的开发者
- Need: 把重复测试失败归并成有优先级、责任人和状态的问题
- Value: 团队先修复最高影响问题，并能从失败证据追踪到关闭或重开

## 验收条件

### AC-001: 去重并推进生命周期

- Type: happy
- Given: 同一门禁已有 testing 状态 Finding
- When: 新报告再次产生相同 fingerprint 的失败
- Then: 聚合器更新同一记录并标记 reopened，不创建重复 Finding

### AC-002: 拒绝非法优先级和状态跳转

- Type: failure
- Given: Finding 使用非 P0–P3 优先级或跳过规定生命周期
- When: 执行 Schema 或状态更新脚本
- Then: 脚本明确失败且不把无效状态写入基线

### AC-003: 只在人工选择后写入 Issue

- Type: security
- Given: 一个开放的 P0–P2 Finding 来自质量报告
- When: 普通 PR 或手动 findings workflow 运行
- Then: 普通 PR 只能预览，只有人工启用 create_issues 的手动任务具有 Issue 写权限

## 证据映射

- AC-001: file=scripts/test-findings.ps1; gate=findings-contract
- AC-002: file=scripts/test-findings.ps1; gate=findings-contract
- AC-003: file=.github/workflows/findings.yml; validator=scripts/validate-workflows.ps1

## 测试设计重点

- 主成功路径: AC-001: 同一 fingerprint 更新原 Finding 并按生命周期重开
- 重要失败与恢复: AC-002: 非法优先级或状态转换被拒绝且不写坏基线
- 变更影响面: 直接回归 Finding 去重和状态；相邻检查重复失败、历史 testing 重开、文件不变以及 GitHub Issue 写权限

## 非目标

- 不允许不可信 PR 内容自动创建或修改 GitHub Issue。
