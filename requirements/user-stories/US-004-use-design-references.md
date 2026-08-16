---
id: US-004
status: verified
risk: high
---

# US-004: 搜索并安装可追溯设计参考

## 用户故事

- Actor: 使用 Agent 构建界面的开发者
- Need: 按关键词或产品类型寻找 DESIGN.md 并安装到目标项目
- Value: 界面获得成熟设计语言，同时保留来源、版本和许可证边界

## 验收条件

### AC-001: 搜索完整目录

- Type: happy
- Given: 目录包含固定 commit 的全部设计参考
- When: 用户按 voice 或 AI 产品类型搜索
- Then: 结果包含 ElevenLabs 或 xAI 等匹配项并返回原始来源 URL

### AC-002: 安装内容与 provenance

- Type: security
- Given: 本地镜像与 catalog commit 一致
- When: 安装一个合法参考到目标目录
- Then: DESIGN.md 与 provenance 同时生成且 SHA-256、commit 和许可证一致

### AC-003: 拒绝未知或漂移来源

- Type: failure
- Given: 设计 ID 不存在或本地镜像不在固定 commit
- When: 执行安装脚本
- Then: 安装在写入参考前失败，不伪造来源记录

## 证据映射

- AC-001: file=scripts/test-design-references.ps1; gate=design-reference-catalog
- AC-002: file=scripts/test-design-references.ps1; gate=design-reference-catalog
- AC-003: file=scripts/install-design-reference.ps1; gate=design-reference-catalog

## 非目标

- 不复制品牌字体、图片、商标，也不自动覆盖项目根 DESIGN.md。
