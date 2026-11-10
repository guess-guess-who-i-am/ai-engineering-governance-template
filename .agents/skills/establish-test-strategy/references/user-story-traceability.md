# 用户故事与测试追踪

## 目录

1. 故事结构
2. 验收条件
3. 测试映射
4. 生命周期

## 1. 故事结构

使用 `requirements/user-stories/TEMPLATE.md`。Actor 是真实使用者或系统消费者；Need 是动作和结果；Value 说明为何值得实现。不要把组件名、数据库表或实现方案写成用户价值。

## 2. 验收条件

每条 AC 只表达一个可观察承诺：

- happy：主成功路径。
- failure：可预期失败和稳定错误语义。
- boundary：空值、上限、重复、并发、超时或生命周期边界。
- security：身份、权限、隐私和滥用路径。
- performance：具名指标、环境和阈值。
- accessibility：键盘、焦点、语义、对比度或动态效果。

高风险故事至少包含一个非 happy 条件。Given 不隐藏无法建立的环境；Then 不写“正常工作”之类不可证伪描述。

## 3. 测试映射

一条 AC 可以映射到多个测试层：

```text
AC-001 -> unit rule + integration persistence + browser journey
AC-002 -> contract error shape + authorization E2E
```

选择最小稳定层证明每个事实，再用少量 E2E 证明连接关系。verified 故事的映射必须包含实际存在的 `file=` 路径。

## 4. 生命周期

- draft：意图仍可能变化。
- ready：AC 已清楚，证据可以规划。
- implemented：代码存在，但证据未全部闭合。
- verified：每条 AC 都有当前、可运行的证据文件。

Issue 可以承载讨论，但合并后的权威故事和 AC ID 应进入仓库，避免 Issue 文本变化后测试失去语义来源。
