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
- CurrentResult: 4进程图服务重装后各100条Hook和socket成功，socket P95为13.92秒、每进程加载一次且同图一致；18项Worker回归、15项门禁通过，d2f748b已推送，未合并main。官方API 26项回归与四来源4.832秒命中、右键部署均通过；5个MCP进程100次同查询1.644秒成功，强退约178ms恢复。Skill/MCP图已全局发布预热；任意100种长任务、注册密钥、硬重启及跨机未验证，整体尚未全部达成。
- RootCauseAnalysis: 图服务原有冷重载与文本缓存膨胀已修复，任意100任务及跨机仍未验证。官方搜索此前漏用GitHub登录、只控并发未控速率、误解OpenAlex重置秒数，并把Crossref书目匹配及网页补搜当作标题检索；现接入认证、分来源限流及标题查询，26项回归和四来源目标验收通过。
- CaseStudy:
  - case 1: 全部调用者超时→旧实现仍计算并缓存；新实现最后等待者取消排队任务，运行任务完成后丢弃结果。
  - case 2: 100路压测全成功但内存4.4–5.6GiB→功能与资源边界必须分开验收。
- NextIdea: 如需更高免费额度，用户完成两家官方账号注册后接入钥匙串并核对实际额度；保留硬重启与跨机未验证边界，不合并main。
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
