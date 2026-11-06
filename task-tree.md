# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - macOS 全局 Codex 治理配置

- Position: 120,120
- Size: 400,520
- Completion: 进行中
- Problem: 如何把仓库治理配置安装成 macOS 全局 Codex 行为，并让并发、Hook、路由和全部 Skill 真正可用？
- Approach: IDE与Codex共用用户级配置、Skill正文、专家原包及GraphToolCall常驻服务；默认入口元数据和项目指令按Codex有效配置发现。独立就绪操作通常成批5–8路，危险或共享写入串行，失败回压；20仅为硬上限。
- Input: 仓库中的 macOS profile、用户 Codex 目录和现有非敏感配置。
- Output: 可迁移macOS配置、全局Skill安装源、常驻worker及右键服务；codex-profile/、安装全局配置.command，第三方库由私有skills-library恢复。
- Metrics: 一键部署后检查无漂移；全部全局 Skill 与 MCP 可路由；调度测试证明4路真实重叠、依赖顺序正确、失败/超时回压、危险任务串行且峰值不超过20；macOS 全链路测试通过。
- Notes: 只支持 macOS；20 是硬上限。全局 Skill/MCP 经过 GraphToolCall；跨机重启、远程 HTTP MCP 目录发现尚未实测。本机、194与110默认Terra均通过真实终端工具测试，官方目录已接入；194与110 CLI为0.166.0，110保留xhigh；桌面界面未直接验证。
- CurrentResult: Mac与194全局资源及现用IDE仍可用；194已部署SSE流读取修复和分段计时，11项回归及生产Codex工具调用通过。主路由仍有11–87秒响应头等待，去掉专属代理的探针100秒超时未采用；备用路由余额不足，长聊天整体提速及自动增加并行仍未证明解决。
- RootCauseAnalysis: 分发与本地排队接近零，主要等待位于上游响应和压缩；非chunked流另有64KB缓冲缺陷，已用read1修复，但当前主路由为chunked。曾把回退日志误当成功，切换后403已回滚，不能把该错误当修复。
- CaseStudy:
  - case 1: 全部调用者超时→旧实现仍计算并缓存；新实现最后等待者取消排队任务，运行任务完成后丢弃结果。
  - case 2: 100路压测全成功但内存4.4–5.6GiB→功能与资源边界必须分开验收。
- NextIdea: 在同一真实长业务任务中关联新流日志与Codex轮次，区分上游首响应、流预读和压缩耗时，再选择针对主瓶颈的变更。
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
