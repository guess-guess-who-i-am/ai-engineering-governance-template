# Skill / MCP / 专家自动路由根因与检索实验

日期：2026-10-25。目标是解释用户任务涉及某个完整专家模块、Skill 或 MCP 时，为什么自动推荐常落在少数熟悉入口，或没有推荐到适合的完整模块；再据此比较可行检索方法。没有改生产路由、全局图、Hook、worker 或远端配置。

## 根因

当前证据指向召回和排序链路，而不是 worker 等待超时：

1. Hook 请求图 worker 的 `top_k` 固定为 8，之后去重并最多注入 4 项。目标排在图结果较后时会被预算截掉；若图检索未召回目标，增加等待时间或 Hook 注入数也无法补回。
2. 19,753 个资源节点共处一个目录，Skill 版本和相近主题节点很多。用户往往描述的是多阶段工作流和产物交接，资源描述则可能只覆盖主题词或一个子步骤。当前语义近邻容易返回词面相关但职责不完整的 Skill；词法检索有时反而能命中用户明确说出的动作和约束。
3. 中文与英文检索行为明显不同。无名称专家挑战中，中文专家任务的图 worker top-4 为 1/4，词法 BM25 为 3/4；把中文查询统一送入英文多语向量通道，两种向量表示的专家 top-4 都为 0/4。由此不能推出“把全库或所有查询预先翻译成英文”会解决问题。
4. 现有评测的目标是冻结目标身份，不是完整语义等价判定。某个专家身份没命中，不代表 top-4 的某个完整替代模块不能完成工作；反过来，命中名称也不证明模块适配、宿主绑定和依赖都可用。用户感受到的“推荐局限”需要能力级盲审，而不能只靠 exact-name Recall。

既有真实 Hook 追踪也发现：四类专家任务各跑中英文时，Hook top-4 仅显示 2/8 个目标；开发流水线专家排在图候选第 39/49，中文性能专家目标在前 50 未出现。移除 Hook 本地词面补位没有改善这组挑战。因此故障至少有两处：图候选召回/排序，以及 Hook 截断；后者不是唯一根因。详见 `docs/RESOURCE_EXPERT_TRIALS.md` 与 `.reports/resource-integration/expert-routing-ablation.json`。

## 研究依据

- MIRACL（TACL 2023）覆盖 18 种语言，含约 78k 查询和 726k 相关性判断，主要定义同语言查询/语料检索。可借鉴的是分语言切片评测与原生语言标注，不是直接照搬其模型。原文：[ACL Anthology](https://aclanthology.org/2023.tacl-1.63/)；DOI: `10.1162/tacl_a_00595`。
- BEIR（2021）强调异质数据集上的 zero-shot 泛化；论文报告 reranker 往往更强但计算成本更高。对本系统的启发是按任务域留出，并同时量延迟，不为了小样本 Recall 盲目加入重排模型。原文：[arXiv:2104.08663](https://arxiv.org/abs/2104.08663)。
- Cormack、Clarke、Buettcher 的 RRF 论文（SIGIR 2009）研究用排名融合多个检索器。它提供的是简单、稳健的融合基线，不是每个语料和任务上都优于最佳单路检索的保证。原文：[ACM DOI](https://doi.org/10.1145/1571941.1572114)，作者公开稿：[PDF](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf)。
- Qdrant 官方 Hybrid Queries 文档用多个 `prefetch` 子查询再做 RRF 或 DBSF 融合；截至本次查询 GitHub `qdrant/qdrant` 为约 35.2k stars。可借鉴多路候选的清晰边界与候选池内融合，不需要迁移数据库。来源：[官方文档](https://qdrant.tech/documentation/search/hybrid-queries/)、[仓库](https://github.com/qdrant/qdrant)。
- Haystack `DocumentJoiner` 支持 `reciprocal_rank_fusion`，并允许给输入检索器配置权重；截至本次查询 `deepset-ai/haystack` 为约 26.8k stars。可借鉴显式的多路融合组件，不应把它当作排序质量证据。来源：[官方文档](https://docs.haystack.deepset.ai/docs/documentjoiner)、[仓库](https://github.com/deepset-ai/haystack)。
- Stack Overflow 的 [Qdrant Hybrid Search Collection](https://stackoverflow.com/questions/79122268/hybrid-search-qdrant-collection) 只有一条低票、未采纳答案，讨论了 RRF 的 `k` 和 rank 起点。它提醒实现要严格验证排名从 1 还是 0 开始，但答案中的参数建议不是可靠的最优值证据；本实验使用论文常见的 `k=60`、rank 从 1 开始。社区搜索没有找到高质量的中文多语路由实证答案，因此不从 SO 推导设计结论。

论文 venue 与 DOI 经原始出版页面或 ACL 核验；未核验这些论文的 CCF 分区，本文不标注 CCF 等级。Star 数是 2026-10-25 API 查询时的仓库元数据，会变化。

## 本地消融

运行脚本：`scripts/experiment-direct-resource-retrieval.py`。冻结输入为当前全局图、全局索引器、80 条原有 holdout/validation/unseen 双语任务，以及 7 条无名称的中英文专家、Skill、MCP 挑战任务。输出在 `.reports/resource-integration/expert-direct-retrieval-20261025.json`。一轮、单请求顺序运行；各变体测量顺序随机化；查询向量缓存清空；模型线程数为 1。输入 SHA-256 前后相同，94 条排名稳定。没有网络模型调用、业务服务调用或 token 计量。

| 方法 | 全集 Top-4 | 全集 Top-8 | 无名称挑战 Top-4 | 中英专家 Top-4 | p50 检索耗时 |
|---|---:|---:|---:|---:|---:|
| 当前 GraphToolCall worker | 47/94 | 60/94 | 4/14 | 2/8 | 342 ms |
| 单路 BM25 | 45/94 | 57/94 | 6/14 | 4/8（中文 3/4、英文 1/4） | 0.99 ms |
| BM25 + 工具向量 RRF | 44/94 | 50/94 | 4/14 | 3/8（中文 0/4、英文 3/4） | 13.65 ms |
| BM25 + 本语言描述向量 RRF | 38/94 | 50/94 | 3/14 | 3/8（中文 0/4、英文 3/4） | 13.62 ms |
| BM25 + 英文多语描述向量 RRF | 32/94 | 40/94 | 1/14 | 1/8 | 15.82 ms |

Top-4/Top-8 是身份标签命中率，不是人工语义相关率或真实任务成功率。全集每个任务只有一轮；挑战集仅 14 条，不能作总体准确率承诺。挑战中两个 Skill 目标在任何常规基线 top-4 都没有命中，MCP 英文目标则 worker 命中、BM25 漏掉，说明单路词法不能替代全局路由。worker 的本进程耗时与候选变体耗时不完全同口径：全局图调用路径更完整，候选基线只测新鲜查询编码与全量打分，不含传输和最终组装；该表用于对比路径成本量级，不是生产端到端 SLA。

## 修改判断

本轮不改生产检索。单路 BM25 在中文专家小样本上明显补召回且很快，但全集和 MCP 对照出现回退；RRF 在英文专家有收益、中文专家却变差，且全集不优于 worker。直接把多路候选融合成最终 top-4，当前证据不足。

下一步若继续实现，先做离线的“词法扩候选、完整模块内重排”试验：保留 GraphToolCall 原候选作为主路，中文 BM25 只补充候选，不剔除原候选；将相同专家/Skill 的版本和父子关系按完整模块保持，不拆成零散步骤；对并集候选用现有完整模块描述/关系信息重排。先补更大、按领域隔离的中英任务集，并由不知道算法和目标名的审阅者标注 top-4 是否完整覆盖任务、错误推荐和等价模块；同时记录 Hook token、端到端延迟、Recall@4/8、MRR。仅当盲审集稳定改善且其他类别无显著退化，才把这个候选通道接入 Hook。

这与已存在的 guarded candidate-pool 机制一致：词法补召回不能绕开预过滤边界，也不能把边界外弱 BM25 命中重新放回融合。相关实现和测试在 `codex-profile/mac/hooks/graph_skill_index.py` 的 `prepare_candidate_pool_fusion` 与 `scripts/test-candidate-pool-fusion.py`。
