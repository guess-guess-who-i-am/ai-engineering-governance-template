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

## 测试设计矩阵

- 主成功路径: AC-001: 通过模拟 Responses API 完成请求、解析和结构化结果校验
- 业务失败与恢复: AC-002: 缺少凭据时在网络请求前失败；AC-003: 未启用时跳过远程调用
- 边界与重复操作: AC-001: 覆盖空模型字段、多个校准案例和重复解析
- 性能与容量: N/A: 本故事验证适配器契约而不声明远程模型时延、吞吐或并发容量
- 身份与权限: AC-002: 未提供 API key 不允许访问模型端点；AC-003: 普通自动任务不能绕过显式开关
- 兼容与历史数据: AC-001: 只承诺当前 Responses API 契约，不读取旧版模型响应或历史业务数据
- 持久数据与副作用: AC-003: 未启用时不得产生外部模型请求；AC-001: 仅保留测试报告而不保存凭据

## 协作触发点

- 需求评审: 协议或启用条件变化前，由平台、测试和安全负责人确认模型端点、凭据边界和失败语义
- 用例评审: 适配器修改后，由平台与测试核对请求、空模型、结构化响应、缺密钥和自动跳过场景
- 阶段交付: 交付模拟服务、适配器提交、真实调用开关状态和本地契约测试结果，不交接真实密钥
- 缺陷与回归: 修复协议问题后复测原始失败，并回归鉴权头、空模型、省略字段、Schema 和未启用分支

## 非目标

- 模拟服务不证明某个真实模型具有足够的审美或判断能力。
- 未获得用户提供的远程凭据前，不声称真实模型评价已经通过。
