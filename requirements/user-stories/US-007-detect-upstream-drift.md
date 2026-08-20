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

## 测试设计矩阵

- 主成功路径: AC-001: 固定 commit 与远端一致时生成 current 报告
- 业务失败与恢复: AC-002: 远端前进时保留比较证据并使门禁失败
- 边界与重复操作: AC-001: 重复检查当前版本结果稳定；AC-002: 任一来源漂移都会列出对应 commit
- 性能与容量: N/A: 周期性漂移检查没有交互时延或吞吐承诺，来源规模变化时再建立运行基线
- 身份与权限: N/A: 漂移检查只读公开远端，不执行合并、推送或授权写操作
- 兼容与历史数据: AC-002: 比较 pinned 与 remote commit，保留已审查历史边界
- 持久数据与副作用: AC-002: 只写结构化报告，不修改 lock、本地源码或上游镜像

## 协作触发点

- 需求评审: 新增上游或改变固定策略前，由治理、许可证和测试负责人确认审查与更新边界
- 用例评审: 漂移脚本变化时，由维护者和测试核对 current、drift、多来源及只读副作用
- 阶段交付: 交付提交、上游 URL、pinned 与 remote commit、检查命令和结构化报告
- 缺陷与回归: 修复后复测原上游，并回归其他来源、网络失败、重复检查和 lock 不被修改

## 非目标

- 不自动合并、复制或重新分发上游变化。
