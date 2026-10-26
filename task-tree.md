# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - macOS 全局 Codex 治理配置

- Position: 120,120
- Size: 400,520
- Completion: 进行中
- Problem: 如何把仓库治理配置安装成 macOS 全局 Codex 行为，并让并发、Hook、路由和全部 Skill 真正可用？
- Approach: 全局配置继续支持Finder右键部署；Skill与MCP统一经过GraphToolCall。工具先构造依赖DAG，同类只读调用优先融合，已知安全独立操作通常5–8路一起发出，失败或超时减半；危险、限流和共享状态任务串行，20为硬上限，遵守更低的接口限制。
- Input: 仓库中的 macOS profile、用户 Codex 目录和现有非敏感配置。
- Output: 可迁移 macOS 全局配置与一键部署；常驻 worker、全局图和 2/4/2 Hook 路由，安装说明见 codex-profile/README.zh.md。
- Metrics: 一键部署后检查无漂移；全部全局 Skill 与 MCP 可路由；调度测试证明4路真实重叠、依赖顺序正确、失败/超时回压、危险任务串行且峰值不超过20；macOS 全链路测试通过。
- Notes:
  - 暂停三平台检查与Git发布，先处理110用户级Codex，不影响其他用户。
  - 110清缓存释放17.62 GiB，已切KPOCE并刷新后台；API请求24.416秒完成，真实Codex首次90秒超时、重测11.395秒完成，模型代理和worker保留。
  - 194为KPOCE主路由、duck备用；duck的403不回退，认证和代理不变，整机重启未实测。
- CurrentResult: 模板分支已推送；15,472 个 Skill 源文件在私有 skills-library 固定提交中。当前本机 4,232 个专家/Skill/MCP 完整包约 1.9GB，但 Gitleaks 506 条命中，其中约309条不呈明显占位符，不能安全上传；因此“另一台电脑完整恢复”尚未可宣称。
- RootCauseAnalysis: 生成资源包混入第三方示例、认证文档及疑似真实凭据，且 Git 无 LFS；直接把1.9GB包提交模板Git会同时触发安全风险和大文件限制。现有安装器已能按清单重建，但发布资产仍缺安全裁决。
- CaseStudy:
- NextIdea: 请用户选择：逐项确认并轮换命中后发布完整包，或明确允许排除命中文件发布非完整包；完成选择后再生成清单、Release资产并做另一台电脑恢复验收。
- SelectedSkills:

# GraphState
- ChainForceNext: 

- Current: ROOT
- Next: ROOT
- NextPlan: 与 Agent 一起把 ROOT 拆成 3-7 个节点，设置 Current/Next/NextPlan，然后按 llm-task-tree/AGENTS.task-tree.md 逐节点推进。

# Edges

## E1 - 待建立

- Endpoints: ROOT
- LabelOffset:
- Label: 待建立子任务边
- Notes: 拆分子任务后删除或替换本边
