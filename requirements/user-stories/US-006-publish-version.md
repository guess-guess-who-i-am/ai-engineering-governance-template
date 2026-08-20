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

## 测试设计矩阵

- 主成功路径: AC-001: 一致版本 tag 通过 release profile 后生成带证据的 Release
- 业务失败与恢复: AC-002: tag、VERSION 或 changelog 不一致时在发布前失败
- 边界与重复操作: AC-002: 普通 PR、缺少 tag 和重复不一致版本均不得创建 Release
- 性能与容量: N/A: 发布流程当前没有时延、吞吐或并发发布承诺，超时由 GitHub 工作流运行证据判断
- 身份与权限: AC-001: 只有受保护 tag 工作流使用最小所需权限发布制品
- 兼容与历史数据: AC-001: tag、版本文件和 changelog 共同固定历史版本语义
- 持久数据与副作用: AC-001: 创建 GitHub Release 和质量报告；AC-002: 校验失败不得创建远程 Release

## 协作触发点

- 需求评审: 发布格式或版本语义变化前，由发布维护者、使用者和测试确认 tag、制品和证据要求
- 用例评审: 工作流变化时，由发布和测试核对成功发布、元数据不一致、无 tag 和远程写入边界
- 阶段交付: 发布候选交付精确提交、版本号、tag、release profile 报告、制品哈希和部署 smoke
- 缺陷与回归: 修复发布问题后复测原候选，并回归 VERSION、package、changelog、tag 和重复发布保护

## 非目标

- 不在普通 PR 或未创建版本 tag 时自动发布。
