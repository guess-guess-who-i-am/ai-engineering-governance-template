# 英文 BM25 稀疏预计算的等价与耗时实测

2026-10-24，在本机真实 19,753 节点图上做隔离实验。没有修改图、向量、全局服务或包内容，没有联网、安装依赖或付费 API 调用。结论是：英文 `BM25.score` 可在保持已测分值精确相等的前提下加速，但整体检索只改善约 6%–10%，不能把局部 2 倍加速宣称为整个 Agent 快 2 倍。

## 根因与唯一变量

上游 `BM25Scorer.score` 每次遍历全部文档，并在每个文档内遍历查询 term，重复计算与该次查询无关的 IDF 和长度归一化贡献。无命中查询仍付出全库扫描成本；长查询还重复查询这些字典。候选版本在初始化时预计算每个 term 的稀疏 `(文档下标, 贡献)`，请求只累加出现的 postings，然后对正分文档执行原来的长度惩罚、名称子序加权和语义短语加权。

只替换 `score`。不改候选池、融合、排序、权重或查询；不合并重复 term；不应用中文实现的查询压缩。保留原式 `idf * (tf * (k1 + 1)) / denominator` 的运算括号与查询累加顺序，避免改成 `(idf * tf) * (k1 + 1)` 后引入浮点末位差异。输出字典也保留原文档顺序。

## 方法与证据

- 实验脚本：`scripts/experiment-sparse-bm25.py`，原始词法结果为 `.reports/resource-integration/sparse-bm25-lexical.json`。
- 完整检索结果：`.reports/resource-integration/sparse-bm25-full.json`。图 SHA-256 为 `f3440f133ee392a0195388189796f63544b635a921569409c10f376ba3dec024`，实验时 indexer SHA-256 为 `67a9aeeaa780e3ac204eda8391858e5ef2186dd1589debc0345bc4f5f0634073`。
- 12 种中英查询，含重复词、空输入、全停用词、无命中、英文短语加权、中文与英文混合及长查询；同一查询至少 3 轮，原版/候选版执行顺序交错。
- 每个查询对全部分值键、逐个 Python float、前 8 名和字典顺序做等价比较，并检查空 restrict、前缀 restrict、已有命中 restrict。全部精确相等。
- 完整检索用独立 `_GraphWorker` 初始化真实模型与图，直接调用通道 `retrieve_with_scores`，绕过 worker 结果缓存。先预热，保留已有模型/查询向量缓存，不把冷启动时间算作 warm 请求。4 组查询每组每版测 3 次，前 8 名及分值全部精确相等。

可复现命令（使用已安装的 GraphToolCall Python 环境）：

```sh
python scripts/experiment-sparse-bm25.py --rounds 3 --report .reports/resource-integration/sparse-bm25-lexical.json
python scripts/experiment-sparse-bm25.py --rounds 3 --full-retrieval --full-cases citation,long --report .reports/resource-integration/sparse-bm25-full.json
python scripts/experiment-sparse-bm25.py --rounds 3 --production-helper --report .reports/resource-integration/sparse-bm25-production-helper.json
python scripts/test-sparse-bm25.py
```

## 测量结果

词法函数首次独立实验的 3 次中位数，单位 ms：

| 查询 | 原 score | 稀疏 score | 加速比 |
|---|---:|---:|---:|
| 英文引文核验 | 34.826 | 14.531 | 2.397× |
| 英文重复关键词 | 44.541 | 24.301 | 1.833× |
| 英文语义短语 | 31.402 | 10.744 | 2.923× |
| 英文无命中 | 6.076 | 0.035 | 175.271× |
| 英文全停用词 | 109.068 | 86.675 | 1.258× |
| 英文长查询 | 296.597 | 206.153 | 1.439× |
| 中文引文核验 | 44.433 | 16.591 | 2.678× |
| 中文长查询 | 464.095 | 285.544 | 1.625× |

英文空输入原本不到 0.001 ms，没有有意义的改善空间。无命中加速比很大，只证明移除空扫描有效；不能用它代表常规任务体验。长查询命中更多文档，原有逐文档短语加权仍耗时，所以提升较小。

完整检索单独实测的 3 次中位数，单位 ms：

| 查询 | 原 score 的完整检索 | 稀疏 score 的完整检索 | 加速比 |
|---|---:|---:|---:|
| 英文引文核验 | 371.370 | 349.162 | 1.064× |
| 英文长查询 | 1342.204 | 1205.371 | 1.114× |
| 中文引文核验 | 84.359 | 56.260 | 1.499× |
| 中文长查询 | 531.934 | 343.113 | 1.550× |

中文表格是在相同中文通道里强制切换“上游原 score / 精确稀疏 score”，是等价控制实验，**不是相对当前已优化中文实现的新增收益**。本次正式补丁只安装到英文通道，现有中文算法不变。

英文 postings 为 903,872 项，纯 NumPy 数组 10,846,464 bytes；两次隔离预计算约 0.85–1.19 秒。这个内存数字不包含 Python 字典、数组对象与构建期临时列表；不能称总内存仅 10.85 MB。预计算属于 worker 初始化一次性成本，不能移到每个用户请求内执行。

## 正式最小补丁与限制

在 `graph_skill_index.py` 增加 `prepare_sparse_bm25(engine)`，仅在 `_GraphWorker` 创建英文 engine 后安装；保持现有中文 `prepare_chinese_retrieval` 不变。postings 数组只读，每次调用独立分配累加数组和输出字典，重复安装幂等。

`scripts/test-sparse-bm25.py` 直接导入正式 helper，6 项通过，包括 20 线程/100 次分值隔离、返回字典互不共享、重复安装、重复 term、负例、空库、中文 token、短语加权、长名称惩罚和名称子序。已有中文 tokenizer 8 项、语义候选池 7 项也通过。完整图实验最初使用等价的独立实现；正式 helper 的真实全量词法验证另存 `sparse-bm25-production-helper.json`，不可把旧 indexer 哈希当作新版本的端到端实测证据。

没有标签集，故“结果精确不变”只说明本次优化不改变原有检索行为，不证明现有结果本身都相关或正确。没有发生 LLM 调用，token 使用量没有实测；本次也不声称 token 减少。上述隔离实验本身不部署全局服务；后续配对回归、七轮计时及本机实际启用已另外完成，见[集成实测记录](RETRIEVAL_RUNTIME_UPGRADE.md)，不能把后续状态倒写成最初实验已部署。
