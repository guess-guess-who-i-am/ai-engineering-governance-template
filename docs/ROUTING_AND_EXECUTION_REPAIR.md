# 路由、并发和实际入口修复

2026-10-20。当前采用原 macOS 基线加明确批准的共享策略修复，不再声称所有文件与旧基线逐字相同。Windows 绑定仍单独维护；Linux/macOS 本轮没有远程部署或重启实测。

## 根因与修复

1. 原路由把“已有别名”当作“禁止图检索”，丢掉了本来能用语义召回的候选。现在只有用户已显式选择的 Skill 才去重排除；用户与外部 Skill 继续走同一个图。
2. MCP 候选原先固定加 1000 分，而本地 Skill 通常只有十几分；按最高分的 55% 再裁剪，放大了尺度错误。现在融合排名，不直接相加原始分数，不给能力类型特权。显式名称优先；融合相同分数时，已声明别名的直接证据先于偶然语义邻近。
3. 原英语编码器把中文前端请求召回正念和股票。改为公开的多语言 MiniLM-L12，并保留 GraphToolCall 的图、词法和向量检索。模型变化必须重建向量，不能混用两个模型的同维向量。没有增加逐轮大模型调用，也没有把完整目录放进上下文。
4. 增加问候/感谢的无任务拒绝场景，过滤低置信语义候选，最多输出四个。当前 0.42 的向量筛选线是本项目工作点，不是论文保证的通用阈值；后续应继续补真实任务和硬负例，不只追求入口返回成功。
5. 并发能力开关本来已开启。旧提醒却同时使用“5–8/最多10”和“首波2–4/最多20”，还假定所有宿主都有 functions.exec。现在只有一个运行口径：首波为可执行独立操作数与 4 的较小值，成功渐增，失败/争用减半，20 只是上限。优先原生批量；仅有 Shell 时可用 Node DAG 执行器，通过标准输入传计划，避免只读任务不能创建计划文件的障碍。
6. 项目 Hook 指向过时的 server 目录，且与 MCP 对运行时相对路径的理解不同。现在由已注册 MCP 位置生成本机运行时指针，项目 Hook 和项目 MCP 转发器共用同一解析器，使用当前 ide/backend 布局。没有保留旧目录兼容分支。
7. 原快照遍历被忽略的镜像、缓存等，可能达到五万文件上限。当前 Git 项目以 Git 文件清单为归属，再有界并行读取元数据；本机样本约 266 个文件、94 毫秒，不扫描被忽略缓存，也不机械截断清单。
8. 预热原先把启动尝试当成就绪：旧服务未释放锁时，新竞争进程退出后会空等。现在跟踪启动进程存活、有界重试，并要求四个进程的图版本与当前文件一致；只读检查不偷偷启动服务。
9. 新模型首次全库编码有明显成本。后续重建按实际 canonical tool text 复用未变化的向量，新增或改变的文本才编码；模型空间变化则全部失效。Skill 正文只刷新 Skill 本身的哈希，不触发只依赖名称/description 的图重建。实际后续重建复用了 15,526 个向量，重新编码 0 个。

## 方法论没有压缩改写

76条仍有效：75条保持全文，并发条目仅移除“通常5到8路，最高10路”的过时数值，其余原句及“及时关闭用完的subagent”要求保留；完整旧句另存中文源本地审阅块。固定提醒仍40条，第1、4、7轮出现；动态路由每轮执行，非固定轮保留短执行提醒。不要把这一变化表述为“完全没变”，也不能把冲突数值一起恢复。

中文源仍由发布器生成镜像和 Skill。新增的 --translation-file 是经过逐行翻译后的暂存输入，不是直接改生成物；仍检查结构、不可变标记、分类、预算，并经过备份与发布后校验。

已补实际的文档归属、项目生命周期和资源登记入口，并将完成验证 Skill 的不存在命令改为真实检查入口 scripts/check.ps1。

## 研究依据与取舍

本次不是在写论文，没有机械堆砌十个 baseline 或与本问题无关的 Nature 案例。以下资料用于决定机制，是否有效仍由本项目的真实输入与测量判断。

- SIGIR 2009，Cormack、Clarke、Buettcher，Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods。采用按名次融合来避免跨通道分数尺度问题；不把 RRF 分数误当成相关性概率，也不声称论文证明本项目阈值正确。作者原文：`https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf`。
- LangChain 成熟实现也采用带权 RRF，并显式按身份去重；参考其 0.3.27 tag 的实现，而非照搬整个 Agent 框架。GitHub 公开页面在本次查询显示约 148,100 stars，star 数不是正确性证明。实现：`https://raw.githubusercontent.com/langchain-ai/langchain/langchain%3D%3D0.3.27/libs/langchain/langchain/retrievers/ensemble.py`；仓库：`https://github.com/langchain-ai/langchain`。
- ICML 2024，Kim 等，An LLM Compiler for Parallel Function Calling。借鉴依赖计划与就绪任务调度的分离，而非为每轮新增一个规划大模型。原始会议页面：`https://proceedings.mlr.press/v235/kim24y.html`；论文：`https://arxiv.org/abs/2312.04511`。
- CCF 的 SIGIR 与 ICML 目录分别在数据库/检索和人工智能门类中列出这些会议。目录：`https://www.ccf.org.cn/Academic_Evaluation/DM_CS/`、`https://www.ccf.org.cn/Academic_Evaluation/AI/`。会议等级不替代任务适用性与实验。
- Sentence Transformers 作者的多语蒸馏说明支持跨语言对齐的编码器选择。该模型的相关蒸馏论文为 EMNLP 2020，不冒称 CCF-A。模型仍须在我们的中文任务上测试，而不是依据名头替代验收。说明：`https://sbert.net/examples/sentence_transformer/training/multilingual/README.html`。
- Stack Overflow 关于 Promise.all 并行/顺序的问题澄清了先构造任务、再整体等待与在循环中逐次等待的差别。它不能证明 Codex 会主动这样调用，也不能证明 CPU 任务用 Promise 就会并行；本项目使用真实子进程和时间区间验收。讨论：`https://stackoverflow.com/questions/30823653/is-node-js-native-promise-all-processing-in-parallel-or-sequentially`。
- OpenAI 官方 Hooks 文档要求新/修改的定义重新审查并按当前哈希记录信任。本机通过正式界面逐个批准了两个项目 Hook，没有使用 bypass 或伪造信任值。文档：`https://developers.openai.com/codex/hooks`。

GitHub API 在本次研究中出现未认证限流，star 数改由同一仓库的公开页面核实，未读取或打印登录凭据。

## 已通过与边界

- 修改前质量测试为 6/10；修改后 10/10，中英请求首选能力与闲聊硬负例均符合标签。中文前端允许经人工查看真实 Skill 内容确认的通用设计候选，不强迫某个固定文件总胜出；首次没有通过的结果仍保留在本机。
- 纯函数回归证明排名融合对通道量级缩放不敏感、没有 MCP 类型加分、身份不冲突、显式请求优先、最多四个。
- 两个用户 Hook 和两个项目 Hook 均 enabled/trusted。项目 Hook 的真实启动、正常结束、漏维护时阻塞均通过。只记录批准不算通过，运行结果另存证据。
- 新图四个常驻进程的版本已核对。八个唯一未缓存请求使用四个不同进程且区间重叠；多语言模型实测增加了部分未缓存检索时间，不能只报缓存命中速度。
- 普通六模块任务没有提示模型并发。最新模型自行使用原生批量测试，六个测试子进程的实际起止时间显示峰值四路。外层工具命令重叠仍为 1，不能把一张卡当成完全串行，也不能因此声称每一轮总有 5–8 张工具卡。六个植入的统计缺陷全部正确诊断，未修改被检查项目。
- 该自然样本端到端约 95 秒，测试命令约 1.1 秒。大量时间仍在工具波次之外；未取得足够分层数据，不能武断归因于官方、模型或某一个本地开关。没有声称端到端获得稳定百分比提升。
- 曾仅在隔离会话请求 code_mode 开关，未获得更强的外层并发证据，未全局启用这个开发中开关。该次样本还受重载影响，不作公平提速对比。
- 最新六模块回答为 373 个可见字符，虽中文数量小于300，但没有达到严格“全部可见字符不超过300”的标准；本次不把这一项冒报为通过。
- 完整仓库 15 项 PR 门禁已运行通过。跨机部署、重启持久性、任意任务的最优 Skill 和模型总会并行的保证，仍不在本轮证据覆盖内。

## 可复用验证

在本项目根目录运行：

```powershell
node scripts/apply-routing-repair.mjs
node scripts/install-mac-profile-on-windows.mjs --check
node scripts/test-routing-fusion.mjs
node scripts/test-skill-routing-quality.mjs
node scripts/test-worker-startup-race.mjs
node scripts/test-parallel-stdin.mjs
node scripts/test-project-hook-runtime.mjs
node scripts/test-mac-profile-on-windows.mjs
node scripts/test-mac-worker-residency.mjs
```

运行时指针、模型、API 凭据、信任记录和本机日志不进 Git。首次需要指定的多语模型，使用现有隔离 Python 运行 scripts/cache-routing-model.py；该脚本固定公开模型 revision，不会换模型或执行远端模型代码。

本机主要证据：.reports/skill-routing-quality-before.json、.reports/skill-routing-quality.json、.reports/project-hook-runtime.json、.reports/mac-worker-residency.json、.reports/trusted-hook-live-result.json、.reports/trusted-hook-live-events.jsonl、.reports/quality/pr.json。测试调用真实模型会产生费用。

配置修改前备份：用户 .codex/backups/router-repair-20261020；后续事务备份在 .codex/backups/portable-profile/。原始 macOS 基线保留在 macos-profile-source，当前策略另存 macos-profile-policy，并记录文件哈希，不能在回滚时混淆二者。

任务树字段的实际旧值→新值见 [本轮回执](ROUTING_REPAIR_TREE_RECEIPTS.md)，不以计划或记忆替代服务端落盘结果。
