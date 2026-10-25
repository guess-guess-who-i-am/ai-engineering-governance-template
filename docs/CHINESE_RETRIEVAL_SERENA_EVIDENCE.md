# 中文 Skill/MCP 路由与 Serena 实测

日期：2026-10-20。范围是全局 Skill/MCP 图路由，不包括任务树知识库搜索。本机已发布并经过实际 Hook；本轮尚未提交或推送 Git，也未在 Windows/Linux 或远程服务器重做此版本验收。

后续用户决定：Serena 因真实任务更慢、累计 token 更多，撤回默认接入，恢复 `rg` 与局部读取。当前默认自有 Skill 为 22 个，MCP 不再包含 Serena；下文 23 Skill、31 MCP 和相关哈希是撤回前实验快照。保留历史结果用于解释决策，不能当作当前配置。新增的双语预热在每个进程启动及换图时完成两通道初始化；检索和重排的静态描述 embedding 已提前构建，新问题的查询向量仍需现场计算。当前行为见[双语预热与撤回记录](PREWARM_AND_SERENA_ROLLBACK.md)，部署与预热数据见 `.reports/retrieval-prewarm-retirement.json`。

## 根因与修复

沿用户输入、候选池、检索融合、Hook 注入逐段检查，发现四处信息损失：

1. GraphToolCall 0.46.0 的旧 BM25 分词和本地 fallback 把连续中文句子当作单词。外部中文目录已有 15,472 条记录，实际有效 Skill 为 15,471 条，另 1 条源文件缺失；不能归因为所有 Skill 没有译文。
2. all-MiniLM-L6-v2 的一条中文探针产生 31 tokens，其中 25 个为 `[UNK]`；直接改用多语模型又会改变英文排序。因此英文保留旧模型，含 Han 字符的查询走多语模型和中文相邻双字分词；自有 Skill 与 MCP 中文检索说明离线维护，保留原始描述，不改规则正文。这里没有逐篇翻译全部 Skill 正文，也没有请求时翻译。
3. 上游候选限制没有覆盖 BM25 融合入口，中文分词后长查询可将约 15k 项重新带入。现在所有通道遵守预过滤候选池，预建词频/文档频率、复用向量数组，并缓存查询意图及固定图展开。中文文本不再触发逐项长文短语扫描，Latin/Korean 评分规则经等价检查保留。
4. Hook 排除了带 aliases 的自有 Skill，同时对 MCP 加 1000 分，再与另一量纲的分数混排。图能召回 Serena，实际 Skill 却无法注入。现在只排除用户显式给出的 Skill，显式工作流优先，图排序其次，词面匹配补位；不混用两套数值阈值。仍限制最多四项。

模型与全图驻留在常驻查询池内，单次请求无需重新加载。英文图共享基础结构，中文向量为相对文件名的内容寻址 `.npz`（约 21 MiB，384 维 float32），发布前校验路径、内容哈希和形状。此文件大小不等于模型及进程总内存。16GB 本机已预热四个查询进程；macOS 压缩/换页会影响 RSS，不能用 RSS 推断全部内存开销。

## 目标召回，而非任务准确率

每组 12 条；top8 表示目标出现在前八名，不代表最终 Hook 一定选中，也不代表 Agent 正确完成任务。

| 输入集合 | 旧 top8 | 新 top8 | 旧首位 | 新首位 |
| --- | ---: | ---: | ---: | ---: |
| 中文 development | 0/12 | 12/12 | 0/12 | 8/12 |
| 中文 paraphrases | 0/12 | 10/12 | 0/12 | 5/12 |
| 英文 development | 10/12 | 10/12 | 8/12 | 7/12 |
| 英文 paraphrases | 6/12 | 8/12 | 2/12 | 2/12 |

中文合计 0/24 → 22/24。英文 development 的 top4 从 10/12 降为 9/12，不能宣称英文所有排序指标无退步。七种 Serena MCP 中文身份探针 top8 命中 7/7。测试是自建小集，改写组与开发组相关，不是独立公共 benchmark，也没有证明 15k Skill 的普遍任务准确率。

证据：`.reports/routed-retrieval-final.json`；模型消融见 `.reports/multilingual-embedding-retrieval.json`。较早权重夹具有误的检索报告不作为最终数字。

## 并发与真实 Hook

每种压测单独运行，使用预热 worker、不同长查询，不靠重复结果缓存凑成功率。报告带有相同图和 worker 哈希。

| 负载 | 成功 | 全批耗时 | 单请求 p95 | 最慢请求 |
| --- | ---: | ---: | ---: | ---: |
| 同时到达 100 条长查询 | 100/100 | 21.560 秒 | 20.686 秒 | 21.282 秒 |
| 每秒到达 10/5/20/25/40 条 | 100/100 | 21.625 秒 | 16.538 秒 | 17.336 秒 |
| 同时到达 100 条短查询 | 100/100 | 16.785 秒 | 15.832 秒 | 见原报告 |

两种长查询负载均观察到四个不同查询进程。初始失败方案只有 27/100 成功、约 55 秒，已经回滚；中间多语方案约 28.85 秒，优化后为 21.56 秒。先前低中文召回基线约 8.9 秒，因此新方案不能宣称比旧方案全面更快。

压测证据：`.reports/multilingual-projected-load100.json`、`.reports/multilingual-projected-stagger100.json`、`.reports/multilingual-short-load100.json`；保留失败证据 `.reports/chinese-retrieval-load100.json`。

实际全局 `hook-dispatch → skill-router → worker` 使用新查询验证：调试任务注入 systematic-debugging（2.169 秒）；源码导航注入 navigate-code-with-serena（2.047 秒）；另一工作目录同样正确（0.949 秒）。三次均没有超时。此次同时有刷新/源码检查，不是严格隔离延迟对照。重复输入的约 0.09 秒缓存响应不作为未缓存性能。证据：`.reports/global-chinese-routing.json`。

全局刷新实测返回 `unchangedGraph:true`，图 inode/mtime 保持，说明相同输入不重建；四进程预热返回 ready/prefilter 均为 true。热更新关闭旧连接时，预热脚本现将 EOF 作为连接重置，在已有总截止时间内有限重试；先红后绿的回归测试见 `scripts/test-graph-prewarm.py`。

## Serena：导航正确，但未证明整体省时省 token

Serena 2.1.0 全局注册七个只读导航工具，使用独立用户级配置，不覆盖用户原有 `~/.serena`。先读一次初始化说明，工作目录已正确激活时直接导航；已知的小片段允许局部读取，日志/配置仍用文本搜索。

十二个真实 MCP JS/Python 符号查询的函数正文、路径、零起点包含末行的范围均与源码一致，12/12；缺失符号返回空列表。热态工具调用中位数 101.143ms。输出估算 5,746 tokens 对每次整文件读取 83,113，但这是 o200k 估算和整文件基线，**不是优化局部读取对照，也不是实际计费总 token**。证据：`.reports/serena-navigation.json`。

同一真实 Codex 小题，固定顺序各跑一次：

| 方法 | 正确 | 端到端时间 | 累计 input tokens | 其中 cached input | output tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| 有界局部读取 | 是 | 31.006 秒 | 37,594 | 14,976 | 109 |
| Serena | 是 | 106.320 秒 | 153,506 | 138,112 | 457 |

Serena 的初始化、项目激活和符号查询均完成，没有工具错误。但该单题更慢、累计输入更多；缓存受固定顺序影响，不能据未缓存量声称费用更低。此前两次 Serena 180 秒超时也保留，不能删去负结果。证据：`.reports/serena-navigation-agent-pair-final.json`、`.reports/serena-agent-pair.json`、`.reports/serena-navigation-agent-pair.json`。这只能确认工具可用，不能证明通用任务成功率或显著收益。

## 上下文压缩未启用

复现 Context Mode 上游 commit `b31c7ee853cb9ea76121e24d368599390972a997` 的测试日志提取：6,185 → 868 bytes，但六项事实只保留三项；测试总数被重复累加，邮件 API 429 故障丢失。原夹具逐行数与汇总也不一致。因此未启用通用有损摘要，不把减字节视为保持准确率。证据：`.reports/context-summary-accuracy.json`；这不是 LLM 完整任务 benchmark。

## 发布、复现与边界

本机统一图为 23 个自有 Skill、15,471 个外部 Skill、31 个 MCP 工具（task_tree 20、node_repl 4、Serena 7）。静态工具清单在旧会话中可能不刷新，需要新会话；不能承诺所有旧会话立即看到新增工具。当前由任务树 IDE 的 keepalive 预热进程监管 worker；本轮没有进行整机重启试验。

已发布产物与上述最终路由、长查询压测报告对应：

```text
graph SHA256  14fb32fae45e3c595a3dabe2708ad426f642164540ef38d48069c8f1e1f26e01
worker SHA256 6c97ffaadf67bc6e4da913f90816e5cc47dcc74f8180c3681f843d51091c1689
```

发布回执 `.reports/retrieval-publication.json` 包含本机备份位置；`scripts/rollback-retrieval-upgrade.mjs` 可按备份恢复。不同阶段备份对应不同版本，最后一次备份主要用于回退 Hook consumer，恢复整个旧检索方案应选首次升级前的备份。右键稳定部署镜像也同步本轮模板和部署依赖，避免下次右键重新覆盖为旧检索实现；回执为 `.reports/retrieval-install-source-sync.json`。

维护者可用原测试入口复现（输出路径与参数以各脚本帮助和已有调用为准）：

```text
scripts/test-routed-retrieval.py
scripts/benchmark-graph-load.py
scripts/test-global-chinese-routing.mjs
scripts/test-serena-navigation.py
scripts/bench-serena-agent.mjs
```

本轮通过的窄验证：中文分词/sidecar 7 项、worker 15 项、loopback/auth/跨进程调用、MCP TOML/握手/分页/故障、预热重试、Mac 安装幂等与凭据隔离、便携安装模拟、Serena 安装检查。缺少 pwsh，未运行 PowerShell 全库治理门禁；便携安装模拟不代表 Windows/Linux 实机通过。全库 diff 检查已有两处无关 EOF 空行问题，未覆盖用户改动；本轮文件单独检查。

结论：中文图路由可用性与目标召回已改善，常驻高并发和 Serena 导航均有真实证据。整体任务的准确率、速度、token 三项全面改善尚未达成。
