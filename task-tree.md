# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - macOS 全局 Codex 治理配置

- Position: 120,120
- Size: 400,520
- Completion: 进行中
- Problem: 如何把仓库治理配置安装成 macOS 全局 Codex 行为，并让并发、Hook、路由和全部 Skill 真正可用？
- Approach: IDE与Codex共用用户级配置、Skill正文、专家原包及GraphToolCall常驻服务；默认入口元数据和项目指令按Codex有效配置发现。独立就绪操作通常成批5–8路，危险或共享写入串行，失败回压；20仅为硬上限。
- Input: 仓库中的 macOS profile、用户 Codex 目录和现有非敏感配置。
- Output: 全局安装源与194部署验收保留在路由分支；docs/COMPLETE_194_DEPLOYMENT_20261108.zh.md；main恢复证据：https://github.com/guess-guess-who-i-am/ai-engineering-governance-template/pull/31
- Metrics: 一键部署后检查无漂移；全部全局 Skill 与 MCP 可路由；调度测试证明4路真实重叠、依赖顺序正确、失败/超时回压、危险任务串行且峰值不超过20；macOS 全链路测试通过。
- Notes: 只支持 macOS；20 是硬上限。全局 Skill/MCP 经过 GraphToolCall；跨机重启、远程 HTTP MCP 目录发现尚未实测。本机、194与110默认Terra均通过真实终端工具测试，官方目录已接入；194与110 CLI为0.166.0，110保留xhigh；桌面界面未直接验证。
- CurrentResult: 全局任务中推荐已安装，四个Hook均经Codex确认信任；真实Codex下一请求及两个IDE工作区消费通过，阶段切换可召回pytest和数据库迁移Skill。20个相同检查点只检索一次，重复候选不再注入，固定提醒仍每三轮；保留两进程常驻图。本轮触发目标已验证，全部领域推荐精度、旧会话热加载和跨机重启未测。
- RootCauseAnalysis: 配置、dispatcher及路由入口均只接受任务入口事件，常驻图再快也无法触发任务中检索；本机Codex工具后只提供标准输出，缺少退出码，不能据此断言失败。
- CaseStudy:
  - case 1: 全部调用者超时→旧实现仍计算并缓存；新实现最后等待者取消排队任务，运行任务完成后丢弃结果。
  - case 2: 100路压测全成功但内存4.4–5.6GiB→功能与资源边界必须分开验收。
- NextIdea: 在真实长任务中评估能力变化检查点的漏触发和误推荐，按证据决定是否扩展事件信号。
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
