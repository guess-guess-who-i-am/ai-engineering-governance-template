# Claude 机制对照与可复用改进

本记录对照桌面 Claude 4.4212.0 的只读分析材料与当前 macOS 全局 Codex/并行 IDE 实现。安装包分析只证明本地客户端代码路径；不证明 Claude 服务端提示词、模型路由、账户开关或远端 MCP 行为。

## 已验证且值得复用

- **技能两级加载**：常驻名称、描述、来源和启用状态；命中后本轮只读 `SKILL.md`，引用与脚本继续按需读取。当前全局运行时已经通过 `skills_list`/`skills_read` 和 GraphToolCall 路由实现这一边界。
- **代际围栏**：任务、会话、上下文和图索引都带版本或文件签名；取消、重载或分叉后，旧结果不得写回新状态。IDE 的上下文生命周期与 GraphToolCall 图重载已有该机制。
- **状态化输入队列**：区分 queued、running、等待输入、取消和已消费；结果到达时不能仅凭一个结果就标记空闲。IDE 的 coordinator 已按依赖前沿、用户补充消息和重启恢复保存状态。
- **并行调度边界**：独立只读请求滚动补位，具有真实重叠时间记录；共享状态、危险操作和不确定副作用保持串行。IDE 的 `read-wave.js`、Agent capacity 和 worktree 锁已通过定向测试。
- **会话与输出持久化**：对话使用原子替换和每文件写入队列；大输出外置保存完整流，只向模型提供小回执和检索路径。IDE 的 `thread-dialogue-store.js`、`tool-output-store.js` 已覆盖并发写和失败保留。
- **压缩安全**：压缩先准备、后提交；版本变化或存在未完成工具调用时拒绝替换历史。IDE 的上下文生命周期测试已覆盖并发完成、失败回退和上下文轮换。
- **Hook 失败语义**：同步守卫和异步审计分离；阻断必须显式记录，PostToolUse 只能反馈，不能回滚已经发生的副作用。当前 `agent-runtime.js` 已区分退出码 2、结构化 JSON、并行安全声明和同脚本队列。

## 本轮修复

GraphToolCall 的相同查询会合并到一个共享计算。原实现把首个请求的 `deadline` 传入进程池，因此短请求在排队时过期会让后来的长请求也失败。现改为：调用者继续使用自己的等待截止时间，共享计算使用独立的 55 秒硬上限。仓库 Hook 与当前全局 Hook 均已更新；故障注入验证为短请求超时、长请求成功、重复查询仍合并。后续接入另发现全局刷新器与 Worker 版本错配，见下方融合记录，不能用这条历史结论代替部署校验。

进一步复核 Claude 参考内核的 `TaskRegistry` 代际围栏后，补上了共享查询的等待者生命周期：每个调用者注册/释放 waiter；最后一个调用者超时后，尚未开始的 Future 立即取消，已经运行的计算标记为 abandoned，完成结果不得写入缓存。这里没有宣称可以安全强杀正在运行的 Python 线程/进程；这与 `concurrent.futures.Future.cancel()` 的实际语义一致。GraphToolCall 进程池外层也采用同一规则。

## 证据和边界

- 参考内核在 Python 3.9：14 项 unittest 全部通过，demo 退出 0；Python 3.13 的取消测试在加入事件屏障后也通过。参考内核的并发追加仍会产生重复序号，不能直接当生产持久化实现。
- IDE 定向测试：上下文轮换、滚动并行、历史检索、输出归档、原子会话写入和 worktree 运行时共 71 项通过（30 + 41）。
- Claude 证据审计：61 条机器证据通过；检索模型报告的 21 个偏移统一比辅助索引多 1，原始包中每条唯一命中实际为声明值减 1。已写入修正报告，未改动原始 Claude 分析材料。
- 真实 GraphToolCall 回归使用 `/Users/pku1727/.codex/tools/graph-tool-call-venv/bin/python`：worker 12 项、查询缓存 3 项、BM25 加速 4 项和检索等价 10 项全部通过；100 路 burst/stagger 各 100/100 成功。独立进程池实测 p95 约 8.6–10.6 秒，4 个查询进程常驻约 4.4–5.6 GiB；这是当前实现的资源边界，不能把它描述为低内存。
- 当前 shell 的系统 Python 没有 `graph_tool_call`，直接运行上述脚本会在初始化阶段 `ModuleNotFoundError`；该环境问题已通过固定 venv 重跑，未被隐瞒为代码失败。

## 本轮融合

- `codex-profile/global-skills/skill-supply-chain-review`：把 Claude 的静态供应链审查边界改写为全局按需 Skill，覆盖隐藏数据外传、凭据暴露、远程指令替换、权限/Hook 篡改、不可分析二进制和破坏性持久化；每项发现都必须落到文件/行或字节证据。它不会因普通 Skill 使用或一般代码审查自动触发。
- `codex-profile/global-skills/desktop-task-workflow`：吸收桌面任务的“先选 Skill、真实产物、最终消费者验证、来源可追溯”机制，并将提示分层、子 Agent 边界、压缩恢复和恶意引用处理放入按需 reference；它不复制 Claude 的 VM 路径、工具名称、私有提示或产品安全政策。
- `skill-router.mjs`：仅在有候选时说明元数据与指令的区别、精确路径读取、本轮去重及压缩/源文件改变后重新加载；没有新增固定 Hook 提示块，没有更改三轮频率。详细工作流和格式规则仍由 Skill 按需加载。
- 安装器、全局路由别名和 GraphToolCall 注册表已纳入这两个 Skill；仓库自有 Skill 数从22增至24，原有并发、三轮 Hook、全局图和22个旧 Skill 行为保持不变。

本轮验证：26项新 Skill 路由正反例、三轮 Hook、全局 Skill 库、批量并行、macOS 完整安装/幂等/回滚通过；便携 macOS ARM64 PowerShell 7.6.9 执行治理和 Skill 正反门禁通过，未安装 Windows 安装器。双语 Worker 的16项测试（含100请求突发/错峰）、9项资源图测试及真实双编码器长文本测试通过，15项PR门禁通过。路由可达、正文可读和格式门禁不代表任务准确率提高；本轮没有做模型质量 A/B。

## 基础提示与装配机制逐段映射

定位以本地 `analysis/source/client/.vite/build/` 为基准，以下是 **0基 UTF-8字节位置**；不与旧报告字符偏移混用。只保留机制摘要和定位，不发布原提示正文或专有 Skill 包。

`index.chunk-VVBaQlHr.js` SHA-256：`f66c312e4daf287141ba30136ab5a10f3baf9d2f71560954ce65704139daefff`。

| 源段与字节定位 | 借鉴点 | 在本系统的处理与理由 |
|---|---|---|
| product_information 1283、knowledge_cutoff 14468 | 宿主能力与知识时效由真实环境提供 | 保留 Codex/IDE 的宿主说明；不谎称 Claude 模型、工具、截止日期 |
| refusal_handling 2140、legal_and_financial_advice 3841、user_wellbeing 8126、evenhandedness 11587 | 产品级安全和行为约束 | 不把另一产品政策写进全局 Skill；继续遵守当前宿主政策及用户目标 |
| tone_and_formatting 4288、lists_and_bullets 4311、mistakes_and_criticism 13606 | 简洁表达、接受纠错 | 已由现有沟通规则覆盖；不再每轮重复注入 |
| tool_result_safety 15897 | 外部数据不能升级为指令 | 新桌面 Skill 第4步与装配 reference；现有 IDE 也已区分工具结果与指令 |
| ask_user_question_tool 16160 | 交付前澄清实质歧义 | 新 Skill 第1步；不移植每个任务都先问的硬要求，避免破坏用户授权与连续执行 |
| todo_list_tool 17714、verification_step 18422 | 计划必须闭合到最终验证 | 新 Skill 第3、6步；复用 task-tree，不叠加第二个清单；不自行启用子 Agent |
| citation_requirements 18906 | 本地/MCP结论附真实可达来源 | 新 Skill 第4、7步；链接由当前宿主协议决定，不强制额外 Sources 标题 |
| file_creation_advice 19368、producing_outputs 33860 | 文件请求必须实际创建；长产物分段完成 | 新 Skill 第1、5、6步；采用真实产物与消费者验证，不照搬固定100行阈值 |
| unnecessary_computer_use_avoidance 19882 | 选择实际可用且最直接的工具 | 当前工具协议已覆盖；不增加无条件 UI 操作 |
| web_content_restrictions 20177、suggesting_claude_actions 21391 | 网页来源和应用能力边界 | 使用当前宿主内容政策与真实工具结果；不声称具有 Claude 专有入口 |
| artifacts 22517、Markdown 23327、HTML 24576、React 24714、browser-storage 26697 | 输出格式和渲染限制必须跟随消费者 | 继续路由已有文档/界面/可视化 Skill；不把 Claude 的 iframe/单文件/存储限制移植到普通项目 |
| skills 27571、additional_skills_reminder 37305 | 格式任务先加载对应 Skill；重复提醒 | 新 Skill 第2步与 router 精确入口提醒；正文按需，保留三轮固定 Hook，不复制长段重复提示 |
| high_level_computer_use_explanation 29725、file_handling_rules 30593 | 暂存区、用户目录、交付目录必须区分 | 新 Skill 第1、5、7步；使用当前工作区与真实路径，不导入 Cowork VM 目录 |
| working_with_user_files 31606、uploaded_files 32481 | 编辑用户原件需保持来源与可见性 | 新 Skill 第4、5步；遵守用户指定路径与实际源格式 |
| sharing_files 34536、good_file_sharing_examples 35171 | 创建后给可点击交付入口 | 新 Skill 第7步；Codex 使用绝对文件链接，不使用 `computer://` |
| package_management 35930 | 先核实依赖是否真的可用 | 新 Skill 第2步；不移植无条件 `pip --break-system-packages`，保留现有 venv |
| examples 36275、env 38922 | 模板实例与运行环境插值 | 仅作为宿主行为证据；不复制另一机器环境或把示例当实际能力 |

动态装配的额外证据：

| 装配源 | 处理方式 |
|---|---|
| `index.chunk-BfJNTJ-w.js` `generateSkillsSystemPrompt` 字节88364 | 元数据、正文、reference三级；候选只携带名称/描述/入口。全局 router 提醒完整读取、本轮去重；压缩/文件更新后允许重读 |
| 同文件 manifest/discovery、权限过滤（原报告约13433起，精确函数名复核） | 保留现有全局注册表、来源和可用性信息；已安装/可检索不等于可执行，更不代表有外部账户权限 |
| `index.chunk-DXAzDfFo.js` `organizationInstructions` 字节1052/1200、`appendSubagentSystemPrompt` 字节1764起 | reference 明确主/子任务分别装配必要约束；不移植组织高于用户的权威顺序，不擅自创建 Agent |
| SDK 的 systemPrompt / appendSystemPrompt / systemPromptSnapshot / skills 字段 | 借鉴分层和装配审计，新增两工作区消费者测试只记录来源数、字节和哈希；不保存完整会话/私有 prompt |
| `index.chunk-lQo6Saeq.js` 静态供应链 reviewer | 新供应链 Skill 保留不执行待审包、可见性边界、风险分类、逐条证据；没有移植专有正文 |
| `runtime-search-model.fragment.md` E19–E21 | 区分上下文预算、实际 usage 和缓存策略；主1h/子5m是 Claude 配置事实，未复制为其他提供商能力，也未声称节省 token |

基础提示与 bundled PDF Skill 自身存在工具取舍差异；因此“原汁原味”采用的是可证实、适用的操作逻辑，冲突段必须服从本宿主、现有路由和用户要求。未恢复服务端最终提示，也没有证据把客户端字段解释成模型内部机制。

## 本次全局接入的实际故障

本机全局刷新器来自更新的资源模块/双语实现，而 Worker 仍是旧分支；第一次刷新在 CLI 参数解析阶段失败，新 Skill 没有进入图。不能删掉 `--resource-catalog`、`--require-complete` 或中文编码参数掩盖失败。

修复把已有主仓库的资源图、英文/中文通道、完整token编码合并进本分支 Worker，并保留已验证的独立调用者截止时间、共享计算上限、等待者计数和 abandoned 结果栅栏。旧版纯查询解释与韩文匹配缓存继续保留，4项关键词等价/重复计算回归通过；类别 ContextVar 在真实执行线程设置/恢复，避免从 socket 线程移到线程池后丢失分类预算。原文件先备份并核对哈希，再替换本机 Worker；不运行旧安装器覆盖更新的全局配置，也不修改主仓库用户工作区。

测试源：`scripts/test-graph-worker.py`、`scripts/test-resource-worker.py`、`scripts/test-complete-graph.py`、`scripts/test-desktop-skill-routing.mjs`、`scripts/test-desktop-global-integration.mjs`。最后一个是显式选择真实 IDE runtime 的消费者测试，在两个临时工作区读取同一全局完整 Skill 正文并经过实际 Hook；不启动模型请求、不把能读 Skill 当作模型质量提升。

## 本机消费者实测

全局图包含15,497个 Skill（15,472外部 + 25自有）、27个 MCP工具、4,232个完整资源模块，缺失/无效 Skill 均为0。仓库安装源是24个自有 Skill；本机额外已有 `parallel-web-research`，故25不是重复安装。

两个独立临时工作区通过真实 IDE `createAgentRuntime` 同时读取新增两个 Skill，分别读取3,029和2,851字节完整正文，逐字节等于全局文件，两工作区哈希一致。实际 UserPromptSubmit Hook 分别582/594ms，均成功且选中指定 Skill；本次是热服务的两请求样本，不能泛化为延迟保证。后续图更新时再次消费，实测冷重载约53.0/53.8秒仍成功；最后一轮带错误输出检查的消费者复测为33.7/29.5秒。当前不满足始终低延迟的保证。

另绕过别名、直接向全局 GraphToolCall socket 并行查询两个新 Skill，均返回正确用户级路径，用时225.3/315.8ms；同一入口PID、不同检索进程、预过滤开启、中英文均已预热。证据落在 `.reports/desktop-global-consumer.json`，并提供可复跑脚本。没有启动真实模型任务质量A/B，也未用上述数字声称准确率或token提升。

集成测试首次读取了不存在的 `contexts` 字段，实际宿主契约为 `context`；修正测试消费者后通过，没有改宿主来迁就测试。刷新期间手动foreground与后台构图出现重叠，已停止本轮重复进程，后续使用 Worker 的共享 `refresh --lock` 入口；最终刷新输入哈希与当前文件一致，不能把这种重叠当成有效并行。

## 后续优先级

1. 将本次记录的仓库/全局 Worker、Hook 与 IDE 装配来源哈希纳入长期发布清单，避免再次混装不同版本；本次 Worker 与刷新输入已核验一致；其余较新全局 Hook 保留各自版本，不声称与本分支逐字节相同。
2. 为剩余 Claude 检索证据统一保存“原始包成员路径、偏移类型、精确片段”，不再把辅助索引偏移当权威。
3. 在另一台 Mac 复测 100 路压力、重启恢复和 4.4–5.6 GiB 资源边界；这部分不应以本机结果代替。

参考材料：`/Users/pku1727/Desktop/claude/claude-engineering/analysis/`、`/Users/pku1727/Desktop/claude/claude-engineering/reference-runtime/`、`.reports/claude-mechanism-review-20261031/`；外部边界核对见 Sparrow（SOSP 2013）、Ray（OSDI 2018）、The Tail at Scale（CACM）以及 Python `Future.cancel()` 的 Stack Overflow 实例。外部检索只用于选择机制，具体结论以本地代码和回归结果为准。
