# 全局配置生效链审计（2026-10-29）

目标：让各工作区实际使用同一份全局配置，并减少真实检索成本。范围是上次提示词清理后的发布、安装、常驻检索和一键复用链；没有逐个执行一万多个 Skill，也没有把格式检查当成任务准确率验证。

## 已证实的根因与修复

| 首次偏离 | 修复与理由 | 可复现验证 |
|---|---|---|
| publisher 只验源/缓存摘要，生成物尾部污染仍可通过 | 重新构造预期生成物，逐文件比较；缓存摘要、上下文预算也检查；`--check` 不刷新全局图 | `node scripts/test-methodology-artifacts.mjs`：13 个生成物逐项污染均拒绝，缺失路由可离线重建，检查不触发刷新 |
| 仓库 publisher 的 Skill 目标指向不存在的 `.agents` | 指向仓库版本源 `codex-profile/global-skills`；运行时仍安装到用户全局目录 | 仓库 publisher `--check --json`，76 条规则通过 |
| 写生成物先删除旧文件，造成暂时缺失窗口 | 同目录临时文件写入后直接 rename | 上述发布回归和实际本机发布通过；未声称验证所有操作系统的断电行为 |
| prompts 历史备份随安装器和稳定部署源复制 | 在进入备份目录前剪枝，避免扫描及传播历史 | `test-portable-profile.mjs`、`test-profile-copy.mjs`，含重复复制 |
| 无环境变量再次安装会重置已有全局 Skill 路径和模型选项 | 显式环境配置优先，否则保留已持久化配置；非法 JSON 直接报错 | 已安装配置保留的红→绿回归；本机默认 `--check` 为 0 漂移 |
| 不同路径指向同一任务树运行时，重复 cp 导致 EISDIR | 比较真实路径；相同目录复用原入口 | 新增软链接重复安装用例通过；本机真实安装发现 21 个 MCP 工具 |
| 图邻接和节点属性重复分配/读取 | 当前已加载的不可变图使用只读缓存；重新加载新图时创建新缓存；不修改评分与关系 | `test-graph-read-cache.py`：5 个随机种子图，多方向、深度、limit、缺失节点，遍历分数与顺序逐项相等 |
| 中文 BM25 等价代数的括号不同，浮点乘法顺序改变 | 与上游逐步骤相同的 numerator / denominator 运算顺序 | `test-sparse-bm25.py`：变化词频/文长反例先失败、修复后通过 |

## 上次 11 个文件逐项复核

| 文件（相对仓库根） | 审核结论 |
|---|---|
| `codex-profile/.codex/hooks/skill-router.mjs` | 删通用免责文字；原始专家入口、完整包路径、可用性和具体失败信息仍保留。8 候选输出回归通过。 |
| `codex-profile/.codex/prompts/global-methodology-source.zh.md` | Git 路由纳入用户现有交付规则，不再次请求已获授权的提交/推送。 |
| `codex-profile/.codex/prompt-publisher/methodology-translation-cache.en.md` | 与中文源的该项变更一致；缓存摘要经过正式 publisher 验证。 |
| `codex-profile/.codex/prompt-publisher/methodology-state.json` | 正式发布更新源/译文摘要；本轮增强完整生成物验证。 |
| `codex-profile/.codex/prompts/global-methodology-router.en.md` | 从源生成，与翻译缓存逐项一致。 |
| `codex-profile/.codex/prompts/global-methodology-router.zh.md` | 从中文源生成，与运行路由语义一致。 |
| `codex-profile/global-skills/README.md` | Git 路由说明与 Skill 触发一致。 |
| `codex-profile/global-skills/method-github-delivery/SKILL.md` | 常设授权适用当前项目交付；没有扩展到无关外部消息或秘密管理。 |
| `codex-profile/global-skills/method-github-delivery/agents/openai.yaml` | 展示说明与 Skill 行为一致。 |
| `codex-profile/mac/hooks/skill-retrieval.zh.json` | 中文检索描述纳入项目交付规则；内容变更会引起一次图重建。 |
| `scripts/test-router-context-budget.mjs` | 验证删去通用免责，同时保留入口、包、可用性及具体失败；不作为准确率证据。 |

## 函数级与真实负载证据

- 独立真实全量图加载约 37.97 秒；常驻服务用于避免每请求重复加载，不代表每请求都要等此时间。
- 带 cProfile 开销的长请求约 1.111 秒，其中 BM25 约 0.428 秒，短语评分 18,206 次约 0.375 秒，图扩展约 0.456 秒；这些是嵌套耗时，不能相加。类别语义候选检索约 0.028 秒，不能把所有延迟归咎于 embedding。
- 同一真实图，10 个长任务 × 3 轮、交替先后顺序、禁用两侧种子结果缓存：图读取缓存让各任务中位数之和从 5.3495 秒到 5.0754 秒，减少 **5.12%**；候选记录逐项相等。这是单进程暖态组件实验。
- 15 个中英文任务的新旧 Hook 对照：候选 15/15 不变，字符 96,105 → 90,915（减少 **5.40%**）；预设名字命中仅 7/14。字符不是模型 token，名字命中不是任务成功率，仍有召回/排序问题。
- 改前真实全局服务 100 个唯一长请求错峰到达：100/100 成功，4 个查询进程，P50 23.66 秒、P95 48.73 秒、整体 55.21 秒。成功接收 100 请求与低延迟是两个不同目标。
- 改后同类负载使用新任务编号：100/100 成功，4 个查询进程，P50 19.14 秒、P95 40.21 秒、整体 46.88 秒。整体观测减少 15.09%，P95 减少 17.49%，但图版本、缓存和操作系统内存状态不同，不能作代码的因果收益。两次 socket 负载均不传类别席位，不冒充完整 Hook 链路。
- 另测真实 Hook 长输入 8 并发：8/8 成功，P95 3.42 秒。单独任务从 Hook 到结果 0.52 秒，验证输出专家 2 + Skill 4 + MCP 2；首次完整上下文为 19,219 字符，说明候选和调度约束也有开销。本轮保留既有注入策略。
- 曾在索引/测试争用期间出现 55 秒超时，保留原失败；独立重跑成功不能抹掉该资源争用问题。
- 内存观测发现 RSS 会低估压缩内存压力；16 GiB 本机不能仅凭 CPU 数增加进程。本轮没有用猜测调整资源规划。
- 当前本机 4 进程来自审计前已存在的未提交资源规划改动，本轮保留且不提交该改动；仓库默认规划与本机这一项仍有差异。不能声称另一台电脑会自动获得相同进程数或该进程数最优。

最终部署与改后负载记录见 `scripts/steps/ROOT/latest/outputs/global-profile-audit.json`。原始 `.reports/global-profile-audit-20261029/` 为本机实验数据，不携带整套 profile/PDF 或机器配置提交。

## 研究依据及适用边界

1. [Pivot Tracing，SOSP 2015](https://cs.brown.edu/people/rfonseca/pubs/mace15pivot.pdf)，DOI `10.1145/2815400.2815415`：按因果信息流跨边界定位，借鉴追踪方式，未复现其系统。
2. [Serverless in the Wild，USENIX ATC 2020](https://www.usenix.org/conference/atc20/presentation/shahrad)：预热与 keep-alive 的延迟/内存权衡；不能直接推出本机最佳进程数。
3. [KGraph，ICDE 2025](https://gaosen.org/resources/papers/KGraph.pdf)，DOI `10.1109/ICDE65448.2025.00081`：读取原文的重复计算、细粒度复用与缓存开销分析。论文也报告缓存可能倒退；本轮只实现并对照只读邻接复用，没有声称复现其分区和 pivot 算法。
4. [Ray worker pool](https://github.com/ray-project/ray/blob/master/src/ray/raylet/worker_pool.cc)：读取预启动决策，依据可用资源/待处理需求；查询时约 44,151 stars，不把 star 数当作本机性能证据。
5. [Argo CD self-heal](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)：期望状态与实际状态比较，借鉴生成物漂移检查。
6. [write-file-atomic](https://github.com/npm/write-file-atomic/blob/main/lib/index.js)：原始代码使用临时文件后 rename；该库并非高 star 性能框架。
7. [Node cp](https://nodejs.org/api/fs.html#fspromisescpsrc-dest-options) / [realpath](https://nodejs.org/api/fs.html#fspromisesrealpathpath-options)：目录过滤会剪掉全部后代；真实路径用于识别同目录别名。
8. [Python futures](https://docs.python.org/3/library/concurrent.futures.html) / [Stack Overflow 的 macOS spawn 初始化讨论](https://stackoverflow.com/questions/64407653/slow-futures-processpoolexecutor-how-to-improve)：超时只是停止等待，不自动取消运行任务；spawn 会重复初始化，支持常驻进程的边界分析。

搜索没有得到直接对应同目录软链接 EISDIR 的 Stack Overflow 结果，修复依据为真实反例和 Node 文档。Apple 的 `phys_footprint` 页面只有字段声明，不能作为完整内存机制的论文依据。尚未核验直接相关的 SCI Q1 原文，不以不相关论文凑数。

## 验证和并发边界

独立只读审查、源码与文献读取使用一批最多 7 项；互相独立的窄测试并发执行，保留各自退出码。安装、图重建、服务预热按依赖串行；正式负载测试与这些重 CPU 操作隔离。100 是被测客户端负载，不是额外打开 100 个终端，也没有为了凑并发创建 Agent。

已通过 publisher/安装/重复复制/软链接/路由上下文回归、真实图缓存与 BM25 差分、16 项 worker 测试、macOS 集成测试；PowerShell 治理校验和 22 个仓库 Skill 校验通过。集成图 shim 只验证接口，不作为生产性能证据。未测试本轮 Linux/Windows 实机，未证明模型任务准确率或端到端 agent 加速。
