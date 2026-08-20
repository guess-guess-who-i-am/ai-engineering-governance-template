---
id: US-008
status: verified
risk: high
---

# US-008: 把测试方法落实为可校验契约

## 用户故事

- Actor: 使用治理模板设计和执行测试的开发者与测试工程师
- Need: 把成功、异常、重复、权限、兼容和数据检查落实到 Story、执行记录与 CI
- Value: 团队不能用一句“覆盖正向和异常”代替真实场景、断言、交接和回归证据

## 验收条件

### AC-001: Story 明确测试场景和观察面

- Type: happy
- Given: 一个包含成功与失败行为的用户故事
- When: 运行 Story 契约验证
- Then: 六类测试设计决策都引用真实 AC 或给出具体 N/A 理由，四个协作触发点均有可执行说明

### AC-002: 拒绝空泛或断裂的测试设计

- Type: failure
- Given: Story 缺少矩阵项、引用不存在的 AC 或用待补内容逃避测试决策
- When: 运行 Story 契约验证
- Then: 验证器指出具体文件和字段并失败

### AC-003: 阶段性交付保留真实执行闭环

- Type: boundary
- Given: 一个阶段性交付、跨边界验证、缺陷修复或发布候选需要测试记录
- When: 验证测试执行记录
- Then: 记录包含真实入口、输入、输出、AC 结果、数据与副作用、缺陷回归和交接决定

## 证据映射

- AC-001: file=scripts/test-test-contracts.ps1; gate=story-traceability
- AC-002: file=scripts/test-test-contracts.ps1; gate=story-traceability
- AC-003: file=scripts/test-test-contracts.ps1; gate=story-traceability

## 测试设计矩阵

- 主成功路径: AC-001: 完整 Story 矩阵通过验证；AC-003: 完整执行记录通过验证
- 业务失败与恢复: AC-002: 缺项、断裂引用和占位理由均被拒绝且不修改源文件
- 边界与重复操作: AC-002: 不存在的 AC 和过短 N/A 被拒绝；AC-003: passed 记录不能包含未通过 AC
- 性能与容量: AC-001: 每个 Story 必须引用性能 AC 或明确说明为何没有时延、吞吐、并发、资源或数据规模承诺
- 身份与权限: N/A: 本地契约验证不访问账号、角色、租户或远程写权限
- 兼容与历史数据: AC-001: 所有既有 verified Story 都迁入同一矩阵契约，新项目生成器继承相同格式
- 持久数据与副作用: AC-002: 验证器只读 Story；AC-003: 执行记录明确 Before、After 和 Cleanup

## 协作触发点

- 需求评审: 测试契约字段变化前，由产品、开发、测试和模板维护者确认适用范围及负担
- 用例评审: 修改矩阵或验证器时，由测试与脚本维护者评审有效、缺项、坏引用和占位内容样例
- 阶段交付: 交付 Story、验证脚本、失败样例、新项目生成结果和 CI 门禁运行证据
- 缺陷与回归: 修复验证器后复测原失败样例，并回归全部既有 Story、新项目生成和执行记录校验

## 非目标

- 不要求每次局部单元测试都编写长篇测试执行记录。
- 不用文档矩阵代替真实测试命令、运行结果或数据断言。
