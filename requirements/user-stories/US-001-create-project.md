---
id: US-001
status: verified
risk: high
---

# US-001: 从治理模板创建独立项目

## 用户故事

- Actor: 使用 Codex 启动新项目的开发者
- Need: 根据项目 brief 创建独立、本地可验证的 Git 仓库
- Value: 产品代码与治理模板分离，同时保留一致的需求、测试和 CI 证据链

## 验收条件

### AC-001: 生成第一条端到端需求链

- Type: happy
- Given: 用户提供合法的仓库名、受众、结果、第一条闭环和项目类型
- When: 非交互运行新项目脚本
- Then: 新仓库包含 brief、上下文、首条用户故事和完整质量门禁清单，并通过 PR 级检查

### AC-002: 发布前不允许静默缺少产品测试

- Type: failure
- Given: 新项目尚未为技术栈配置单元、集成、端到端、性能和安全等产品门禁
- When: 执行发布级质量检查
- Then: 检查明确列出所有未配置的必需门禁并失败，而不是给出虚假的绿色结果

## 证据映射

- AC-001: file=scripts/test-new-project.ps1; gate=template-bootstrap
- AC-002: file=scripts/test-new-project.ps1; gate=template-bootstrap

## 测试设计重点

- 主成功路径: AC-001: 用合法 brief 从真实脚本生成可检查的独立仓库
- 重要失败与恢复: AC-002: 产品测试未配置时发布门禁失败，但本地项目仍可继续配置
- 变更影响面: 直接回归生成文件、Git 仓库和质量清单；相邻检查目录隔离、首条 Story、远程授权失败及本地项目保留

## 非目标

- 不在尚未选择技术栈时伪造具体框架测试。
- 不自动创建远程 GitHub 仓库，除非用户明确授权。
