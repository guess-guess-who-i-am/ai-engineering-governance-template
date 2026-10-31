# 私有资源发布与恢复

模板仓库已设为 PRIVATE，`guess-guess-who-i-am/skills-library` 也为 PRIVATE。第三方专家/Skill/MCP 源包应保存在资源库私有 Release；完整包不塞进模板 Git，也不把本机生成的 GraphToolCall registry 当作可移植资源。本轮尚未发布完整包：扫描发现潜在凭据，完成逐项审查前禁止上传。

当前资源快照：4,232 个完整模块（447 expert、3,307 skill、478 mcp-service），安装副本共 48,974 个文件。15k+ Skill 源库独立保存在私有仓库 Git 历史。完整模块包内保留原始目录、成员、脚本及附件；不得拆包改写。已安装镜像自身记录了被明确排除的 45 个凭据、缓存或不可移植附件；本次发布器会遇到凭据样式文件名或符号链接时停止，不静默删除内容。

2026-10-25 Gitleaks 8.30.1 扫描 1.95 GB 安装资源包发现 506 个命中（其中通用 API-key 规则 448 项，另有 JWT、云密钥、curl 凭据与 private-key 规则）；私有库已有 Git 历史另有 582 项。报告仅存于被 `.reports/` 忽略的本机目录，不包含在提交中。扫描规则可能命中示例，但在安全审阅判定前不能把这些文件上传或声称安全。

## 创建可校验快照

先完成扫描命中的人工/确定性凭据复核；对真实凭据须从来源移除并轮换，但不要静默改写第三方原包。未消除或明确隔离的命中不得发布。确认来源后，在模板工作区执行：

```sh
node scripts/export-resource-packages.mjs --source "$HOME/.codex/resource-packages" --output /tmp/private-resource-export --revision <source-commit>
```

发布器输出完整文件清单（逐文件 SHA-256/字节数）、归档 SHA-256、清单 SHA-256，并检查归档目录项数。再运行 Gitleaks 检查来源与输出；确认私有仓库权限及扫描结果后，将 `resource-packages.tar.gz` 和 `resource-packages.manifest.json` 附加到私有资源仓库的版本化 Release。不要上传本机图、向量缓存、registry JSON、`~/.codex/config.toml`、Hook 信任数据库或任何认证状态。单文件超过 GitHub Git 的普通文件限制时，只放 Release asset。

## 恢复与验证

有 Release 读取权限的目标电脑下载归档与 sidecar manifest。先核对发布页所记的 SHA-256，再解压至临时位置；按 manifest 对所有文件逐一重算 SHA-256，数量、路径或散列有任意不符就停止。验证完成后才将原始包目录导入全局 resource-packages；再从适配电脑新建资源 catalog、模型缓存与 GraphToolCall 图，不能复用其他电脑的绝对路径或索引。

恢复完整文件包并不等于 MCP 凭据已配置，也不等于每个第三方专家的宿主工具都存在。目标电脑用自己的认证方式配置各 MCP；真实任务应以调用收据和产物验证为准。

## 自动化真实使用状态

直接运行 Hook 脚本只证明脚本可运行，不证明 Codex 每轮会执行。2026-10-25 的 app-server 检查发现全局 Hook 为 `modified`（未获信任），项目 `userPromptSubmit` Hook 因 shell 找不到 `node` 以 exit 127 失败。已加项目 Node 启动器，绝对路径回退单测通过；配置变更后仍需客户端重新信任。

2026-10-26 去掉验收器的 120 秒本地定时器后，显式点名专家的只读真实 turn 在 213,734 ms 自然完成：读取完整 `performance-testing-expert` 原入口与测量 JSON，并给出队列容量的 p95/吞吐对照分析。这个结果证明专家完整入口可由模型使用，且本项目没有专家 turn 硬超时。

随后经 Codex 客户端批准后，app-server 确认全局与项目 4 个 Hook 均为 `trusted`。不点名专家的真实请求在 5,214 ms 自动推荐 `performance-testing-expert`、`apm-performance-expert`，并读取专家原始 `MODULE.md`；但该 turn 24 分钟无事件，最终分析未验收。期间发现仓库 Hook 的 `sharedKitDir` 被错误地相对 `llm-task-tree/` 解析，导致 UserPromptSubmit exit 1；改为按项目根解析后，隔离项目的 UserPromptSubmit/Stop Hook 测试及真实 Hook 测试通过。再次真实回放时两类 Hook 都成功，路由用时 44,012 ms，但模型随后启动 `mcpToolCall` 后无完成事件；具体工具名和 MCP 等待原因仍未确认。故自动路由与专家入口加载已验证，端到端专家分析仍未通过。

Codex 上游 issue [#54872](https://github.com/openai/codex/issues/54872) 讨论的是 `PreToolUse`/`PermissionRequest` 同步策略 Hook 的有限 wall-clock 等待，不是模型专家执行 turn；不得用它推断专家有同样时限。该议题记录省略 timeout 仍会采用有限默认值，也不代表无限等待已在此安装版本支持。
