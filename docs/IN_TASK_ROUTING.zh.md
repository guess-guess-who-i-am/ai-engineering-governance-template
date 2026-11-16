# 任务执行中的专家、Skill 与 MCP 推荐

## 原因与当前行为

旧配置只注册 `UserPromptSubmit`、`SessionStart`；dispatcher 和路由脚本也只接受入口事件。因此每条用户发言都会推荐，但同一条发言引发的工具循环不会重新推荐。常驻图的速度和并发能力不能补足缺失的触发事件。固定提醒每三条用户发言注入一次，与推荐频率分别控制。

现在全局注册 `PreToolUse`、`PostToolUse`：

- 工具前：工具族、操作阶段、文件类型或命令程序发生变化时，向同一常驻 GraphToolCall 查询。
- 工具后：IDE 提供结构化失败状态时，检索诊断工作流；结构化成功不检索。
- 本机 Codex CLI 0.169.0-alpha.11.1 的 shell 工具后事件实测只有标准输出，丢失退出码。因此每类操作补一次结果复核，不把输出文字猜成失败。
- 同一会话、轮次、Agent 和工作区内，查询检查点和候选条目分别去重；相同检查点并发到达只允许一个检索。失败释放检查点，允许重试。只新增必要候选，不重注入完整目录或固定提醒。
- 状态只存哈希和空回执，不保存命令、工具输出或凭据；SessionStart 清理超过七天的记录。原来的两进程常驻图不变，没有新增模型进程或每次重载图。

检查点是能力变化的有限代理，不能理解所有推理中的语义变化。在已注入的推荐说明中，Agent 会得到同一全局检索器的 `--query` 调用方式，用当前具体需求主动再检索。该路径不经过另一个 LLM。没有工具调用且 Agent 未主动查询时，不会机械地再次推荐；不能据此宣称推荐质量或任务成功率已提高。

## 安装与信任

正常使用现有 macOS 全局安装入口；所有工作区共享用户级 Hook、全局 Skills 与常驻图，不写工作区 Skill 副本。

首次增加这两个事件时，在 Codex `/hooks` 审核 `PreToolUse`、`PostToolUse` 的全局 dispatcher。安装器不伪造信任哈希。2026-11-16 本机已通过实际 TUI 分别审核，随后通过官方 `hooks/list` 读取确认四个全局事件均为 `trusted`。现有运行中的客户端是否热加载由宿主决定；未重载配置的旧会话应重新打开，不能把新会话验证说成所有旧会话立即生效。

安装器更新保留现有外部库位置、中文 embedding 和完整性要求，避免仅更新路由就意外重建图；Python 字节码缓存不属于部署源。

## 可重复验证

```sh
node scripts/test-in-task-routing.mjs
node --test scripts/test-routing-context.mjs
node scripts/test-hook-cadence-mac.mjs
node scripts/test-routing-worker-errors.mjs
python3 scripts/test-native-in-task-hooks.py --output .reports/native-in-task.json
node scripts/test-codex-profile-mac.mjs
node scripts/test-live-in-task-routing.mjs --ide-runtime /actual/ide/server/agent-runtime.js --output .reports/live-in-task.json
```

2026-11-16 证据：

- 修复前回归在“PreToolUse 被丢弃”断言失败；修复后检查点测试和45条会话上下文测试通过。
- 真实本机 Codex harness 使用本地确定性 Responses 与图服务夹具，执行两条真实 shell 命令和三次模型请求，工具前推荐及工具后复核均进入下一次请求。该测试验证宿主接线，不消耗远程模型额度、不评价模型能力。
- 实际 IDE runtime、实际全局图、两个临时工作区并行：首次推荐937/1001ms；失败后检索400/374ms；重复检查点与成功结果均无新增上下文；候选正文读取成功。两个工作区开始/结束区间重叠，不是仅配置并发上限。
- 20个相同检查点并发只领取一次；20个同名候选只投递一次；失败重试、跨会话/Agent/工作区/轮次隔离、敏感查询过滤均通过。
- 全局安装及 `--check` 通过，76条方法论校验通过。原三轮提醒回归不变。没有测量所有领域的推荐精度、长期资源曲线或跨机重启。

本轮官方 Hook 文档页面返回403；转而核对 OpenAI Codex 上游 `hooks/src/events/pre_tool_use.rs`、`post_tool_use.rs` 和本机生成的 app-server schema，并用真实本机 harness 验证。Stack Overflow 官方 API 的定向查询返回200、零结果，不能据此断言功能不存在。详尽本机日志保留在 `.reports/in-task-routing-20261116/`，不发布临时会话正文。
