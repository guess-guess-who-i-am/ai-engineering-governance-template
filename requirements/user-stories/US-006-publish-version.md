---
id: US-006
status: verified
risk: high
---

# US-006: 从受保护版本 tag 发布证据

## 用户故事

- Actor: 模板发布维护者
- Need: 用一致版本、变更记录和 release 门禁创建 GitHub Release
- Value: 使用者能把发布内容追溯到 tag、验证报告和明确的版本语义

## 验收条件

### AC-001: 版本元数据一致

- Type: happy
- Given: VERSION、package.json、CHANGELOG 和 tag 指向同一语义版本
- When: release workflow 在版本 tag 上运行
- Then: release profile 通过后创建带质量报告的 GitHub Release

### AC-002: 拒绝版本不一致

- Type: failure
- Given: tag 与 VERSION 不同或 changelog 缺少对应日期段
- When: 运行发布校验
- Then: 在创建 GitHub Release 前明确失败

## 证据映射

- AC-001: file=.github/workflows/release.yml; validator=scripts/validate-release.ps1
- AC-002: file=scripts/validate-release.ps1; workflow=.github/workflows/release.yml

## 测试设计重点

- 主成功路径: AC-001: 一致版本 tag 通过 release profile 后生成带证据的 Release
- 重要失败与恢复: AC-002: tag、VERSION 或 changelog 不一致时在远程写入前失败
- 变更影响面: 直接回归版本元数据和 Release；相邻检查受保护 tag、最小权限、质量报告、重复发布及失败不创建远程制品

## 非目标

- 不在普通 PR 或未创建版本 tag 时自动发布。
