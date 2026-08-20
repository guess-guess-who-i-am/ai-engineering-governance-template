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

## 测试设计矩阵

- 主成功路径: AC-001: 同一 fingerprint 更新原 Finding 并按生命周期重开
- 业务失败与恢复: AC-002: 非法优先级或状态转换被拒绝且不写坏基线
- 边界与重复操作: AC-001: 重复失败不创建重复记录；AC-002: 跳级状态转换被拒绝
- 性能与容量: N/A: 当前 Finding 规模没有时延、吞吐或并发承诺，规模变化时需新增可比较基线
- 身份与权限: AC-003: 普通 PR 只有预览权限，人工触发才允许写 Issue
- 兼容与历史数据: AC-001: 已有 testing 记录再次失败时保留身份并转为 reopened
- 持久数据与副作用: AC-001: 检查 findings.json 原记录更新；AC-002: 失败时文件不变；AC-003: 未授权不写 GitHub Issue

## 协作触发点

- 需求评审: Finding 字段、优先级或生命周期变化前，由质量负责人、使用者和测试确认影响与迁移边界
- 用例评审: 聚合器或工作流修改时，由脚本维护者和测试核对去重、非法转换、重开和权限场景
- 阶段交付: 交付提交、合成 Finding 输入、运行命令、变更前后基线和工作流权限检查结果
- 缺陷与回归: 修复后复测原 fingerprint 和状态，并回归其他优先级、已有历史记录及无 Issue 写权限路径

## 非目标

- 不允许不可信 PR 内容自动创建或修改 GitHub Issue。
