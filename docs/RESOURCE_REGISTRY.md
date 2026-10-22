# 资源登记与生命周期

新增资源时记录所有者、用途、创建与关闭入口、存储位置、权限边界、费用或容量限制、健康检查及恢复方式。不要在登记中保存密钥值。

本模板现有资源归属如下：

- 检索服务：用户 Codex 配置拥有其端点、锁、日志和四个工作进程。Windows 入口为 `scripts/prewarm-mac-worker.mjs`，健康与认证检查为 `scripts/test-mac-worker-residency.mjs`。端点认证内容仅保存在受保护的用户目录。
- Skill 库与图：外部原件由独立 Skill 仓库拥有；用户配置拥有本机索引、模型缓存与输入指纹。注册表或图存在不代表每个候选语义相关；用 `scripts/test-skill-routing-quality.mjs` 验收代表性正例和硬负例。
- 模型调用：沿用用户已配置的提供方和凭据，不打印、不提交凭据。`scripts/test-codex-hook-runtime.mjs` 会产生真实调用费用，应使用隔离只读测试项目并保留运行证据。
- 技术资料批量MCP：由用户`config.toml`中的`technical_research`段拥有，入口`scripts/technical-research-mcp.mjs`，安装/回滚备份由`scripts/install-technical-research.mjs`管理。每次最多20项公开API查询，按来源配额限制并发；完整本机缓存位于用户`.codex/technical-research-cache/`，有明确获取时间与缓存年龄，不存鉴权值。冷联网与缓存性能分别验收，见`docs/TECHNICAL_RESEARCH_PERFORMANCE.zh.md`。
- Hook 信任与备份：属于当前机器用户。安装文件改变后重新核对信任及实际运行，不复制其他机器的批准记录，不绕过检查。回滚从明确版本逐项恢复，先检查后续用户修改。

临时测试进程在结束时关闭；常驻检索进程只有在其注册生命周期要求下保留。不要误把最大并发槽位当成实际驻留或实际利用率。
