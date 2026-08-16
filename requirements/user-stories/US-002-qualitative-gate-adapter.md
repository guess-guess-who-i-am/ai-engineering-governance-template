---
id: US-002
status: verified
risk: high
---

# US-002: 安全接入大模型定性门禁

## 用户故事

- Actor: 维护 AI 工程治理模板的开发者
- Need: 在不保存真实凭据的情况下验证大模型调用协议，并只在远程明确启用后自动评价
- Value: 大模型门禁既可接入实际网关，又不会因空配置持续制造红色 CI 或虚假通过

## 验收条件

### AC-001: 验证大模型适配器协议

- Type: happy
- Given: 本地模拟服务实现 Responses API 并返回严格结构化结果
- When: PR 质量 profile 执行定性适配器契约测试
- Then: 三个校准与目标案例完成请求、解析和结果校验，模型名留空时不发送 model 字段

### AC-002: 拒绝缺失凭据

- Type: security
- Given: 大模型 API key 为空
- When: 调用定性门禁脚本
- Then: 脚本在发送网络请求前明确失败，且不把空配置报告为已评价

### AC-003: 未启用时不自动调用外部模型

- Type: failure
- Given: GitHub 变量 LLM_GATE_ENABLED 未设置为 true
- When: 相关文件触发 pull request 或 main push workflow
- Then: 真实模型评价 job 被明确跳过；手动触发仍要求 BASE_URL 和 API_KEY

## 证据映射

- AC-001: file=scripts/test-qualitative-gate.ps1; gate=qualitative-adapter-contract
- AC-002: file=scripts/test-qualitative-gate.ps1; gate=qualitative-adapter-contract
- AC-003: file=.github/workflows/qualitative-gate.yml; validator=scripts/validate-workflows.ps1

## 非目标

- 模拟服务不证明某个真实模型具有足够的审美或判断能力。
- 未获得用户提供的远程凭据前，不声称真实模型评价已经通过。
