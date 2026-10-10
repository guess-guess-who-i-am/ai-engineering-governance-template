---
story: US-000
commit: working-tree
build: local-build-or-artifact-id
environment: local-test-environment
status: passed
---

# US-000 测试执行记录

只在阶段性交付、跨边界验证、缺陷修复或发布候选测试时创建。普通局部单元测试不需要写长报告。

## 真实入口

- Command: 实际执行的命令、URL 或用户操作入口
- Input: 使用的合成输入、账号角色、数据规模或前置状态
- Output: 用户可见结果、响应、制品或报告位置

## 场景结果

- AC-001: passed; evidence=file:仓库内真实日志、截图、报告或测试文件路径
- AC-002: passed; evidence=gate:quality/gates.json 中的真实门禁 ID

`evidence` 只接受存在的仓库相对路径 `file:`、已登记质量门禁 `gate:`、HTTPS 工件 `url:` 或外部运行标识 `run:`，不能填写一句结论。

## 数据与副作用

- Before: 执行前需要观察的数据库、文件、队列、审计或外部状态；不适用时写具体理由
- After: 执行后实际观察到的状态变化和不应发生的副作用
- Cleanup: 清理、回滚或可重复运行方式

## 缺陷与回归

- Defects: 本轮缺陷 ID 与状态；没有时明确写 none
- Fix: 修复提交或构建；没有修复时说明不适用原因
- Regression: 直接复测、相邻消费者、重复操作、历史数据和兼容范围

## 交接

- Developer self-test: 开发自测入口和结果
- Test handoff: 测试收到的提交、构建、环境和已知限制
- Decision: passed、failed 或 blocked，以及下一责任人和动作
