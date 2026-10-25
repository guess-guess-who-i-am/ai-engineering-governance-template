# Serena 定向清理验收

2026-10-20。用户要求直接删除失败接入、不留该接入的备份，并明确保留实验报告。本轮不修改远端、不提交或推送 Git，也不新增所有任务通用删除规则。

## 已清理的范围

- 全局 Codex 中本配置管理的 Serena MCP 整个配置块；不是仅设置为禁用。
- 专属 wrapper、运行描述、导航目录与语言服务器依赖，导航 Skill 及其路由；空的仓库版本源目录和稳定安装源残留。
- 本次安装的 uv 工具 serena-agent 及其三个命令入口；本仓库实验生成、无用户记忆的 .serena 项目缓存。
- 本次 Serena 安装与撤回的专用备份，以及混合预热备份中仅包含该失败实现的 retired-mirror 子目录。混合备份其余检索/worker 内容没有删除。

这些目标没有另存新的本地恢复备份。保留用户原有的全局 .serena 数据、其他 MCP、认证/provider、其他历史备份和所有实验报告。迁移遇到不符身份的文件或 Skill 会在写入前拒绝处理；独立管理的 Serena 服务不受影响。

## 防止以后部署重新留下旧实现

删除迁移已同步到稳定右键安装源。macOS 和便携部署入口先清理再执行常规安装，避免正常安装备份再次捕获旧 Serena 配置。其他功能的备份机制没有修改。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| 清理前后既有实验资料哈希 | 133 个文件全部相同；没有覆盖旧报告 |
| 清理目标与原有数据 | 13 个精确残留目标均不存在；用户原有全局 .serena 仍在 |
| 定向迁移测试 | 无备份删除、已禁用/嵌套配置、带引号/CRLF、幂等、只读检查、身份校验、用户数据/报告保留均通过 |
| macOS 安装回归 | 临时用户下旧 Serena 升级、安装备份不含旧接入、任意工作区右键调用及重复安装通过；依赖使用模拟器 |
| 便携配置测试 | 通过；不等于 Linux/Windows 实机验收 |
| 当前真实全局 worker | 4 个查询进程，中英文 16/16 成功，模型/图加载次数稳定为 1 |
| 当前真实 Hook | 本仓库与另一工作区均正确推荐调试 Skill，约 253ms，无 Serena 推荐 |
| 现用图与 worker | 内容哈希均未变化，仍为 22 自有 Skill、15,471 外部 Skill、24 MCP 工具 |
| 受管撤回检查 | 稳定安装源返回 current，changes 为空 |
| 本轮 diff/语法 | 窄范围空白检查、Node 与 shell 语法检查通过 |

本轮实际执行：scripts/test-retire-serena.mjs、scripts/test-codex-profile-mac.mjs、scripts/test-portable-profile.mjs、scripts/test-prewarmed-global-routing.py，以及稳定源撤回检查。真实 worker 的本轮新结果写入 .reports/serena-removal-prewarm-verification.json，原始文件哈希清单及清理目标记录于 .reports/serena-removal-integrity.json。此前实验正文保持原样：[中文检索与 Serena 证据](CHINESE_RETRIEVAL_SERENA_EVIDENCE.md)。

## 明确保留的未完成项

本机完整部署检查未通过，报告 5 项既有差异：config.toml、context-refresh.mjs、hook-dispatch.mjs、external-library-config.json、routing-rules.json。现用并行提示词仍为 V4（起始 2–4 路），仓库版本为 V5（已有安全独立任务通常 5–8 路）；此外 Finder 服务检查提示 missing or stale。本轮没有覆盖这些非 Serena 配置，也不把临时环境通过当成本机全量部署通过。

缺少 pwsh，未运行 PowerShell 全库门禁。未重跑完整 LLM 任务准确率/总 token 对照，不宣称全面提速；保留此前 100 请求成功但满载 Hook 约 17 秒的负结果。

## 任务树真实落盘回执

仅修改 ROOT 的两个节点字段，GraphState 和执行流程未改。下面的旧值和新值直接来自 task_tree_write 返回的 changes：

- ROOT.CurrentResult
  - 旧值：已撤回默认Serena并恢复局部搜索/读取，更新一键及右键安装源；当前全局图含22自有、15471外部Skill和24个MCP工具。四个常驻查询进程均预热中英文模型与索引，检索/重排的静态向量离线保存，16条新查询加载次数稳定，跨工作区Hook正确。100条不同长查询全成功、全批17.8秒，但满载Hook仍约17秒；未证明完整任务准确率、速度和token全面改善。
  - 新值：Serena受管接入、专属运行文件/安装包及相关备份已直接删除，133个既有实验资料哈希未变，右键安装源已同步清理迁移。全局图仍含22自有、15471外部Skill和24个MCP；四进程双语预热16/16成功且加载次数稳定，跨工作区Hook正确，一键升级隔离测试通过。本机部署全检仍有5处既有差异及右键服务检查不一致；此前100请求成功但满载Hook约17秒，未证明总任务准确率、速度与token全面改善。
- ROOT.NextIdea
  - 旧值：用户可在194原Codex对话继续；若再失败，按KPOCE和Duck分别记录状态码、首字节和完整回复耗时，三平台发布仍暂停。
  - 新值：用户确认后单独核对本机5项部署差异及右键服务差异，再决定是否同步V5；本轮不改远端或Git。
