---
id: US-008
status: verified
risk: high
---

# US-008: 用风险触发的测试契约保留关键证据

## 用户故事

- Actor: 使用治理模板设计和执行测试的开发者与测试工程师
- Need: 用轻量 Story 重点、项目级质量门禁和按需执行记录约束测试证据
- Value: 既不能用一句“覆盖正向和异常”代替证据，也不能让无关清单拖慢普通研发

## 验收条件

### AC-001: Story 保留最小关键测试决策

- Type: happy
- Given: 一个包含成功与失败行为的用户故事
- When: 运行 Story 契约验证
- Then: Story 明确主成功路径、最重要失败或恢复，以及具体变更影响面

### AC-002: 风险决定额外约束

- Type: failure
- Given: Story 缺少核心重点、引用不存在的 AC，或高风险 Story 省略失败路径
- When: 运行 Story 契约验证
- Then: 验证器指出具体文件和字段并失败；低中风险 Story 不被迫填写无关维度

### AC-003: 阶段性交付保留真实执行闭环

- Type: boundary
- Given: 一个阶段性交付、跨边界验证、缺陷修复或发布候选需要测试记录
- When: 验证测试执行记录
- Then: 记录包含真实入口、输入、输出、AC 结果、数据与副作用、缺陷回归和交接决定

## 证据映射

- AC-001: file=scripts/test-test-contracts.ps1; gate=story-traceability
- AC-002: file=scripts/test-test-contracts.ps1; gate=story-traceability
- AC-003: file=scripts/test-test-contracts.ps1; gate=story-traceability

## 测试设计重点

- 主成功路径: AC-001: 完整轻量 Story 设计通过验证；AC-003: 适用时执行记录通过验证
- 重要失败与恢复: AC-002: 缺项、断裂引用和高风险省略失败路径均被拒绝
- 变更影响面: 直接回归 Story 与执行记录验证；相邻检查新项目继承、不同 risk 等级、质量门禁引用及普通局部测试不增加文档

## 非目标

- 不要求每次局部单元测试都编写长篇测试执行记录。
- 不要求每个 Story 罗列所有质量类别；项目级类别由 `quality/gates.json` 统一决定。
- 不用文档重点代替真实测试命令、运行结果或数据断言。
