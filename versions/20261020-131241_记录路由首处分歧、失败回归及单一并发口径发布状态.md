# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - macOS 全局 Codex 治理配置

- Position: 120,120
- Size: 400,520
- Completion: 进行中
- Problem: 如何把仓库治理配置安装成 macOS 全局 Codex 行为，并让并发、Hook、路由和全部 Skill 真正可用？
- Approach: 全局配置继续由 Finder 右键一键部署；Skill 与 MCP 统一经过 GraphToolCall。工具执行先构造依赖 DAG，同类只读调用优先融合，普通波次从2–4路开始，成功渐增，失败或超时减半；危险、限流和共享状态任务串行，20仅为硬上限。
- Input: 仓库中的 macOS profile、用户 Codex 目录和现有非敏感配置。
- Output: 可迁移macOS配置、全局Skill安装源、常驻worker及右键服务；codex-profile/、安装全局配置.command，第三方库由私有skills-library恢复。
- Metrics: 一键部署后检查无漂移；全部全局 Skill 与 MCP 可路由；调度测试证明4路真实重叠、依赖顺序正确、失败/超时回压、危险任务串行且峰值不超过20；macOS 全链路测试通过。
- Notes: 最新要求是在 Windows 直接采用 GitHub 的 macOS 版本；跨机重启与三轮提醒的长期保持效果仍未验证。
- CurrentResult: 9份Prompt与22个Skill仍与macOS基线一致，4个预热检索进程通过8个未缓存请求验证。用户授权后已通过正式界面批准两个用户Hook，并修复Windows启动命令；新会话实际注入三个标记，普通任务回答236字。该任务8次命令仍串行，模型自动并发及长期跨机会话效果不能宣称完成。
- RootCauseAnalysis: 此前直接运行脚本绕过了Codex实际使用的PowerShell命令层，未发现引号路径缺少调用符，信任通过后仍启动失败。已补真实命令回归并修复安装器；注入成功不等于模型必然采用并发。
- CaseStudy:
- NextIdea: 保持macOS原版Prompt和评分，用确有独立分支的普通任务测量模型工具重叠，定位自动并发仍串行的边界。
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
