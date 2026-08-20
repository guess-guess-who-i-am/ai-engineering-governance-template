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

## 测试设计矩阵

- 主成功路径: AC-001: 从完整目录搜索匹配参考；AC-002: 安装内容和 provenance
- 业务失败与恢复: AC-003: 未知 ID 或漂移镜像在写入前失败
- 边界与重复操作: AC-003: 不存在的设计 ID 被拒绝；AC-002: 重复安装仍按固定来源生成一致 provenance
- 性能与容量: N/A: 当前目录搜索和本地安装没有对时延、吞吐、并发或目录规模作产品承诺
- 身份与权限: N/A: 搜索和本地安装不涉及账号、角色、租户或远程写权限
- 兼容与历史数据: AC-003: 本地镜像必须与固定 commit 一致，不能把旧或漂移内容伪装成当前来源
- 持久数据与副作用: AC-002: 同时检查 DESIGN.md 和 provenance；AC-003: 失败前不得留下部分安装文件

## 协作触发点

- 需求评审: 新增来源或改变安装边界前，由设计维护者、许可证审查者和测试确认来源、版本和目标目录
- 用例评审: 目录或安装器变化时，由设计维护者和测试核对搜索、合法安装、重复安装、未知 ID 和漂移场景
- 阶段交付: 交付固定 commit、目录记录、安装命令、临时目标目录及内容与 provenance 哈希
- 缺陷与回归: 修复后复测问题来源，并回归其他 catalog 项、未知 ID、镜像漂移和失败无残留

## 非目标

- 不复制品牌字体、图片、商标，也不自动覆盖项目根 DESIGN.md。
