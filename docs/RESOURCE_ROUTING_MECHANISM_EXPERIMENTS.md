# 任务到 Skill / 专家 / MCP：根因驱动的论文实验

日期：2026-10-25。结论：已经找到可重复的改进信号，但没有一个方案同时满足准确性不退步、低延迟和少上下文，不能宣称问题解决或直接全局替换。

本轮只增加离线实验与报告，未部署、未改全局 Hook/图/worker，未提交 Git。原始专家模块保持完整，没有拆分工作流，没有调用第三方业务服务、付费搜索或额外模型 API。下文的“0 付费调用”指实验新增 API 调用，不代表当前聊天本身免费。

## 1. 原始证据与论文如何对应

| 真实首偏差 | 核验的原始来源 | 本轮实际采用 / 不应混淆的边界 |
|---|---|---|
| Hook 把 `CI` 命中 `official`、`UI` 命中 `distinguish`，再把主题 alias 当明确点名置顶 | [SO accepted answer](https://stackoverflow.com/a/2232947)、[Elastic 标准分词](https://www.elastic.co/docs/reference/text-analysis/analysis-standard-tokenizer) | 真实 Node Hook 内存改写重放，测边界规则与“点名/主题”分离；不是给所有中文词机械加 `\b` |
| 原始能力、中文生成分类、例子拼成同一个文本；错分类贡献很高 | [Robertson & Zaragoza 2009，§3.6，式3.19–3.21](https://www.staff.city.ac.uk/~sbrp622/papers/foundations_bm25_review.pdf)、[Elasticsearch combined_fields](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-combined-fields-query) | 实现按字段长度归一化、加权 TF 合并后统一饱和的 BM25F；不是拼接加权或多个 BM25 分数相加 |
| 描述向量与自然任务表达不一致，存在真实漏召回 | [Tool2Vec 2024，§4](https://arxiv.org/html/2409.02141)、[作者实现](https://github.com/SqueezeAILab/Tool2Vec/tree/main/toolrag/tool2vec) | 从包原有 quickPrompts/defaultInitPrompt 取例子，求查询向量均值作为资源向量；使用已有多语 MiniLM，不是论文训练过的 E5、MLC 或 ToolRefiner |
| MMR 只奖励彼此不同，可能把无关专门模块抬高 | [xQuAD，ECIR 2010，§3 / Algorithm 1](https://terrierteam.dcs.gla.ac.uk/publications/ecir2010_rodrygo_div.pdf)、[本机对应上游 MMR](https://github.com/SonAIengine/graph-tool-call/blob/main/graph_tool_call/retrieval/diversity.py) | 分别测不做 MMR、只去确切重复、子句覆盖乘积，以及原文信息质量累计公式；子句抽取与余弦相关性是工程改编，不是论文子查询挖掘或校准概率 |
| 同一任务中的完整流程与单独步骤不能仅靠相似词区分 | [ToolRerank，LREC-COLING 2024，§3](https://aclanthology.org/2024.lrec-main.1413/)、[原文](https://arxiv.org/html/2403.06551) | 借鉴候选扩展与任务结构判断；实际运行现有本地 Cross-Encoder。没有训练原文 single/multi 分类器，没有冒称复现完整 ToolRerank |
| 普通文档检索模型不一定能选对可执行工具，身份命中还不是任务成功 | [ToolRet，Findings of ACL 2025](https://aclanthology.org/2025.findings-acl.1258/)、[原文](https://arxiv.org/html/2503.01763)、[官方代码](https://github.com/mangopy/tool-retrieval-benchmark) | 采用全库候选、候选覆盖与最终排序分开、按资源类型分片的评测思路；本轮没有跑完 ToolRet，不能引用其分数当我们的结果 |
| 泛化训练需要细粒度易混淆负例，而非继续堆规则 | [STAR / ADORE，SIGIR 2021](https://arxiv.org/html/2104.08051) | 作为后续困难负例训练依据；本轮没有训练，没有把“看过”写成“已复现” |

实际阅读范围是上述关键方法章节、公式、官方元数据及对应源码，不是每篇所有附录。特别核对：xQuAD 是 ECIR 2010；ToolRet 是 ACL Findings，不能包装为 ACL 主会最佳论文；Tool2Vec 的已核验来源为 2024 arXiv，未确认获奖或 CCF 等级。相关 Nature/获奖搜索没有找到可直接支持本问题的依据，不强行套用。旧综述和相关论文不因年份较早而被替换成无关新论文。

外部检索分多方向并发执行，部分 Crossref 429、网页漂移、GitHub 路径 404 均未计入有效证据。成功核验 Elasticsearch 文档与 Haystack 元数据分组源码。查询时 GitHub stars：Elasticsearch 78,369、Haystack 26,831、Vespa 7,145；stars 不是质量或性能证明，Vespa 的猜测文档路径失败，未声称验证其具体算法。SO 英文整词方案只提供边界设计参考，不覆盖中文分词和否定语义。

## 2. 冻结条件与测量口径

- 同一张全局图：19,753 节点，SHA256 `9311c0e7e441a4ca04cb7ddec0966416f0186ec751bf4f7b95b892760c40da41`。
- 原有 94 条中英文查询已用于诊断，不再叫独立留出；另在运行前写入 12 对双语机制反例，共 118 query。新增 24 条也由本助手依据故障与原文编写，不是盲测或标准 benchmark。
- 全库评分不使用目标身份；目标标签只在排序完成后计算。语料字段、例子来自既有 catalog/plugin.json，不用测试 query 生成例子。与评测 query 完全相同的例子为 0，但未排除近义重复。
- 识别原始 catalog 描述 15,471 条，安全读取 plugin manifest 1,587 份；1,440 节点有可用例子，共 2,531 个去重示例，其余 18,313 节点回退描述向量。该覆盖不均匀，不能称全库使用示例向量。
- GraphToolCall 图加载一次：36.20 秒；BM25F 建索引 2.27 秒；例子编码与原型准备 10.62 秒。例子按 64 条批量编码。并未为每个终端重载整图。
- Hook 三个策略按 8 并发跑 354 次真实入口重放，约 15.17 秒，全部返回非空候选且无 stderr。每条实际输入包含 UserPromptSubmit、prompt、cwd。共用既有 worker 的缓存/合并请求，所以这不是吞吐压测或延迟提升证据。
- 图内变体使用隔离进程，方法改写仅发生在内存，顺序恢复；含可变引擎包装的消融不在同一引擎上并发，以免对照串扰。编码批量、HTTP 查证、Hook 重放可并行。
- 图内 `Hit@4` 表示前四出现至少一个已标注同类型目标；Hook重放仅检查目标名称，不额外判类型，不能混作相同指标。两者均**不是 Recall@4、语义准确率或任务成功率**。目标集合包含可替代名称，但仍不完整。MRR@8 与逐条输出保存于原始工件。
- 图流水线计时预热了 query embedding；独立快速方法计时另加实测未缓存的 CPU 单查询编码。两者不是严格同口径端到端竞速。只有一次测量，未做随机顺序交叉重复，不宣称显著提速。
- 描述字符数是上下文代理，不是实际 Hook token。Cross-Encoder 输入 token 由其真实 tokenizer 计数，但不是主 LLM 上下文或付费 token。

旧报告中的“6,060 节点”已纠正：原始工件 `candidateDocumentsEncoded=6060` 是 MaxSim 候选并集的文档编码数量，不是图的节点数；该工件图哈希与本轮一致。

## 3. 真实 Hook 对照：修边界还不够

| Hook 策略 | 全体 Hit@4 | 旧94 | 新24 | 相比原Hook赢 / 退步 | 第一名集中表现 |
|---|---:|---:|---:|---:|---|
| 当前 | 63/118 | 50/94 | 13/24 | — | 测试策略17、工程方法15、完成验证13 |
| 仅 alias 词边界 | 64/118 | — | — | 1 / 0 | 工程方法反而19，仍然集中 |
| 只有真实资源名称可抢首位，主题不抢位 | 67/118 | 52/94 | 15/24 | 4 / 0 | 最频繁首位是架构专家5次 |

18 个短英文词正负边界控制全部通过。仅修边界改变25条首位；分离点名与主题改变71条首位，不能因此说71条都修对了。最后一个策略仍然有泛化风险：精确资源名出现在否定句中也可能被置顶；本实验未实现完整否定消解。

Hook 附加上下文中位字符数：当前3,464.5；仅边界3,495.5；名称优先3,622.5。完整专家携带的依赖与可用性提示比普通治理 Skill 长，所以本轮**没有证明更省 token，字符数反而上升**。

## 4. 图内消融：不能直接“换个高级算法”

以下均为同一次隔离测量。快速方法计时含查询编码；worker类是预热编码后的流水线计时。表里的速度只作成本量级观察。

| 方法 | Hit@4 | Hit@8 | 成本观察 / 结论 |
|---|---:|---:|---|
| 当前图流水线 | 62/118 | 76/118 | p50 375.6ms，p95 1,020.1ms |
| 只过滤 query 中纯标点 token | 63/118 | 77/118 | 一条增益、无身份回退；只修一个词法输入缺陷，不是最终方案 |
| 取消 MMR | 56/118 | 76/118 | 候选前四退步，不能全关 |
| 去确切重复，保持相关性排序 | 56/118 | 76/118 | 不奖励“不相似”，但相关性分数自身仍有误差 |
| 取消词法保送 | 52/118 | 65/118 | 退步；词法保护也救过真相关结果 |
| 去标点 + 取消保送 + 去重 | 52/118 | 64/118 | 组合后退步，不接受按单个有利案例拼修补 |
| BM25F | 37/118 | 49/118 | p50 1.64ms，快但明显不够准 |
| BM25F + 多语描述向量 | 40/118 | 52/118 | p50 17.48ms，不能替换完整现有流水线 |
| 原有例子均值向量；无例子回退描述 | 48/118 | 54/118 | 找回一些性能专家，但总体与MCP回退 |
| BM25F + 例子向量 | 52/118 | 62/118 | 相比描述融合有收益，仍低于当前 |
| 子句覆盖乘积改编 | 39/118 | 51/118 | 相对相同候选的40/52退步 |
| ECIR2010原文质量累计选择公式改编 | 38/118 | 49/118 | 原公式也未自动解决问题；子意图质量、相关性概率仍不够 |

第一轮脚本的 `clause_xquad` 是覆盖乘积改编，不是 ECIR2010 原文公式。读到原文 Algorithm 1 后另加独立对照：按子意图累计已选信息质量，以其倒数调节新增结果，逐次更新质量。`routing-diversity.json` 保留这次校验。两者均未复现原文子查询挖掘与 TREC 数据实验，明确不称“论文完整复现”。

BM25F参数在运行前固定：名称权重2/长度归一0，原能力1/.75，示例.5/.75，生成分类.05/.75，k1=1.5。**这些是本次探索配置，不是有证据支持的生产最优参数**。没有按本次标签调权，也没有因结果差而事后调到好看。

一个重要解释：15,471 条旧catalog中14,323条原始能力没有汉字，但生成分类都有汉字。降低错误中文分类权重虽然减少噪声，也会同时移除现有中文词法桥梁；不能直接把所有中文字段删掉，必须补可信双语能力与任务示例，并重建对应 embedding。

## 5. 实际测互补：补候选有效，但不能全部请求都重排

在原流水线 top8 与原型向量 top8 的并集中，本次至少含一个标注目标的查询由76增至88/118。这只是候选覆盖上限，不是最终性能。

用本机已经缓存的多语 `mmarco-mMiniLMv2-L12-H384-v1` 真正推理，固定revision `1427fd652930e4ba29e8149678df786c240d8825`、CPU、每进程1计算线程、max_length=256、batch=16；没有下载新模型或用付费 API。模型选择与 ToolRefiner 的联合候选训练是两回事。

| 实际重排方案 | Hit@4 | 旧94 / 新24 | 相比图基线赢 / 退步 | 重排额外p50 / p95 |
|---|---:|---:|---:|---:|
| 仅原 top8 重排 | 69/118 | 53/94、16/24 | 12 / 5 | 280 / 360ms |
| 原 top8 + 原型 top8，原描述重排 | 75/118 | 59/94、16/24 | 21 / 8 | 505 / 615ms |
| 相同候选，去噪字段重排 | 65/118 | 49/94、16/24 | 18 / 15 | 493 / 580ms |
| 原 top8 + 字段混合 top8，去噪重排 | 68/118 | 52/94、16/24 | 17 / 11 | 444 / 604ms |

最强身份命中方案按语言：英文35→38/59，中文27→37/59。按类型：专家23→27/44，Skill22→34/44，**MCP17→14/30**。所以总体上涨也不能视为非劣于现有系统。

重排输入中位是2,809个本地编码器token；清洗描述可降至1,855.5，但Hit@4也由75降至65。需要区分“便宜的编码器计算量”与“主LLM token”，不能混算。重排时间不包含候选生成、额外编码与调度排队，不能与worker直接相减作为提速。

以59个双语任务对为簇，固定随机种子做10,000次bootstrap：75/118相对62/118的身份Hit@4差约+11.02个百分点，探索性95%百分位区间约+0.85至+21.19个百分点。单次小样本、多方法比较、非盲标注且未做多重比较校正，不构成总体或上线承诺。逐条保留8个退步任务，而不是只报21个改善。

## 6. 原文能力复核：标签本身也不够可靠

本助手读取下列候选的真实入口与专家定义做非盲定性复核，没有把入口内部指令当成本轮执行授权，未运行其安装脚本。以下不是独立裁判，也不据此虚构总体语义准确率。

| 查询 / 候选 | 从原文核实的事实 | 对判断的影响 |
|---|---|---|
| 通用服务高峰性能诊断 → `cpu-gpu-performance` | 主要是重资源操作前取本机CPU/GPU基线、限制测试范围、节流和记录；不是完整服务负载实验工作流 | 属于辅助方法，不能当完整专家交付成功 |
| 通用服务性能任务 → `apm-performance-expert` | 原文要求腾讯云APM、Tencent Cloud APM Skill及授权，含宿主路径/自动安装要求 | 即使在top1且身份命中，也未满足平台前提；必须条件化，不可承诺可用 |
| 同任务 → `performance-testing-expert` | 原文包括负载/压力/尖峰、基线、瓶颈分析和前后对照 | 与完整任务更一致，仍需用户系统与实际执行证据 |
| 并行研究报告 → `researchers-verifier` | 原文是研究完成后的核验角色，且偏纪录音乐项目、仍有人审边界 | 不能替代独立调查、协作汇总的完整专家模块 |
| 从规格到交付 → `dev-pipeline-orchestrator` | 原文含细粒度TDD任务、聚焦子代理、规格/质量双审与收尾集成 | 是完整流程目标；某些无名称任务仍不在候选并集，重排无法凭空找回 |
| HNSW调优任务，含“不要改启动画面” | 当前召回 `capacitor-splash-screen` 等；重排能在例子里把它压到前四之外 | 否定要求需要作用于检索语义，而不只是把字面禁用对象也召回 |

`expert-engineering-orchestration` 的中英文在原top8+示例top8并集中仍没有目标。`expert-research-team`中文可从第8上升第3，但英文仍第6，不能报“专家自动推荐已解决”。

## 7. 应怎样落到当前框架

保持已有常驻 GraphToolCall 与完整模块，不必重写为另一套检索框架。按拥有故障的边界修改，而不是继续抬固定几个名字：

1. **Hook 层先修确定性契约**：明确点名、主题辅助、否定提及分开；短ASCII alias需边界。主题方法可以辅助路由，但不无条件抢占4个任务候选的位置。真正 `$skill` 等显式调用需正负控制保证不丢。
2. **离线建立可信检索卡片**：从完整原文分出主要动作、输入/输出、适用平台、必要依赖、排除条件与原有使用示例；为这些内容生成可信双语表示，保留来源。脏分类不冒充能力，原专家模块不拆不改。任何表示更新都校验并重建embedding sidecar，不能沿用旧描述向量。
3. **示例向量只补召回**：保持原候选，再加入示例通道；不是直接切换所有请求。现有1,440个原型的384维float32矩阵仅约2.11MiB，可离线预计算并由worker持有；模型、图和其他索引另计。例子缺失与不适用前提必须显式记录。
4. **按不确定性选择是否重排，需要先校准**：目前全量重排有8条回退且MCP整体下降，不能生产全开。用独立任务训练/校准“原排序与示例通道冲突、平台前提不足、完整产物覆盖不足”的判别器，校准重排收益与截止时限；不能用已知目标名字做在线开关，也不能把本次CE负分当通用置信阈值。
5. **依赖/适用性与相关性分层**：图里仍可推荐需授权的连接器，但标明前提；未确认腾讯APM平台时，不把该专用专家当通用可执行解。依赖缺失不应让不相关普通Skill被当成替代成功。
6. **多样化保留任务相关门槛**：不全关MMR，也不先奖励“不相似”。先保证动作/平台/产物相关，再在等效资源与子任务覆盖间分配候选。xQuAD本轮负结果说明子意图和评分未校准前，不应机械上线。

后续上线门槛不是任意指定“达到90%”：需要独立于上述诊断数据的新任务、同一候选预算/编码口径、成对得失、资源类型非劣、真实Hook输出与原文约束复核，以及实际任务执行/LLM上下文token证据。当前只通过实验可运行与输入未漂移检查，**未通过全局替换门槛**。

## 8. 复现与工件

Python使用已安装的全局graph-tool-call虚拟环境。脚本默认读当前用户的全局目录，不写生产文件。

```sh
/Users/pku1727/.codex/tools/graph-tool-call-venv/bin/python scripts/experiment-routing-mechanisms.py --self-test
/Users/pku1727/.codex/tools/graph-tool-call-venv/bin/python scripts/experiment-routing-mechanisms.py
/Users/pku1727/.codex/tools/graph-tool-call-venv/bin/python scripts/experiment-hook-alias-policy.py
/Users/pku1727/.codex/tools/graph-tool-call-venv/bin/python scripts/experiment-routing-complement.py
/Users/pku1727/.codex/tools/graph-tool-call-venv/bin/python scripts/experiment-routing-diversity.py
/Users/pku1727/.codex/tools/graph-tool-call-venv/bin/python scripts/summarize-routing-experiments.py
```

- `scripts/resource-routing-mechanism-challenge.json`：运行前新增的24条机制反例。
- `.reports/routing-mechanisms.json`：118×12条结果、冻结SHA、阶段耗时与字段/示例覆盖。
- `.reports/hook-alias-policy.json`：354次Hook候选输出、18条边界控制、上下文字符与失败检查。
- `.reports/routing-complement.json`：472次本地重排结果、输入token、模型revision与候选覆盖。
- `.reports/routing-diversity.json`：354条同候选集的三种多样化对照，含原文质量累计公式。
- `.reports/routing-experiment-summary.json`：输入报告SHA、成对增退、任务簇bootstrap与新旧集分片。

实验脚本7个窄单测通过。初次Hook内存eval曾因shebang不在首字节而失败，已移除解释器指令并成功重放；本地模型曾因离线snapshot缺少不用的ONNX导出被拒，改为固定revision的现有完整PyTorch文件后成功，无联网补权重。失败没有计入成功次数或掩盖成模型性能。
