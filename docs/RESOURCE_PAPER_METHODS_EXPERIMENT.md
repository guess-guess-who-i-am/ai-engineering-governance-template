# 检索论文方法的离线实测

日期：2026-10-25。目标是用本机现有全局图、离线模型和固定查询集实际测量不同检索方法，而不是仅整理论文或用 BM25 代表全部方法。本实验不修改生产路由、全局图、Hook、worker 或服务器；没有外部模型调用，付费 token 为 0。

## 方法与实现边界

| 方法 | 本次实际测量 | 忠实度与边界 |
|---|---|---|
| 当前 GraphToolCall worker | 原生图查询路径 | 既有基线，完整度最高，但其运行时与隔离候选方法不是完全相同口径 |
| BM25 | 单路全库词法排序 | GraphToolCall 的 BM25 tokenizer/统计量；作稀疏基线 |
| RRF 混合 | BM25 top-64 与 dense top-64 并集，按 RRF `k=60` 排序 | RRF 论文方法的标准排名融合；候选扩展本身也改变了预算 |
| RM3-style | BM25 top-10 伪相关文档，取 top-10 扩展词，原查询/扩展模型各 0.5 | 固定参数，不依测试标签调参；手写 RM3-style 查询模型插值，不是原论文系统或 Terrier/Anserini 的忠实复现 |
| MaxSim late interaction | 在 BM25/dense top-64 并集重排，文档描述最多 128 token | 使用已有多语 MiniLM token hidden state 做 MaxSim；只是 ColBERT-style 近似，不是 ColBERT 训练权重、分词/蒸馏或索引实现 |
| Cross-Encoder | BM25+dense 融合的 top-32 候选上用 mMARCO 多语 Cross-Encoder 打分 | 使用缓存的现成模型真实推理；非特定于 Skill/MCP 的相关性微调模型 |

论文路线依据：RM3 查询模型伪相关反馈（Lavrenko & Croft, SIGIR 2001，[DOI](https://doi.org/10.1145/383952.383972)）；RRF（Cormack et al., SIGIR 2009，[DOI](https://doi.org/10.1145/1571941.1572114)）；ColBERT late interaction（Khattab & Zaharia, SIGIR 2020，[arXiv](https://arxiv.org/abs/2004.12832)）；SPLADE 稀疏神经扩展（Formal et al., SIGIR 2021，[arXiv](https://arxiv.org/abs/2107.05720)）；HyDE 假设文档嵌入检索（Gao et al., ACL 2023，[ACL Anthology](https://aclanthology.org/2023.acl-long.99/)）。本次没有把 RM3/MaxSim 近似标成原论文复现。

## 数据与复现

- 冻结集为 holdout、validation、unseen 共 80 条任务的中英文版本，加 7 条无资源名称的专家/Skill/MCP 挑战任务双语版，共 94 个 query。
- 全局图有 19,753 个工具节点。旧报告误将 `candidateDocumentsEncoded=6060` 写成图规模：6,060 实际是全部查询候选并集里做过 MaxSim 文档编码的去重数量，不是全库规模；原始工件图哈希与当前一致（`9311c0e7…da41`）。查询/标注文件和图哈希记录在 `.reports/resource-integration/paper-retrieval-methods-20261025.json`。
- RM3 和 BM25 对全语料排序。RRF/MaxSim 使用两个 top-64 列表的并集（最多 128 项）；候选召回单独记录，避免把候选外目标误算作 reranker 排名失败。
- MaxSim 文档向量预计算耗时 27.3 秒；这是冷启动/重建成本，不计入单 query p50。在线查询编码加候选重排 p50 约 13-16 ms。
- 结果是身份标签 Top-k，不是盲审相关性，也不是下游任务成功率。小样本不支持总体准确率承诺。

## 结果

全体 94 query 的 Top-k（精确目标身份）：

| 方法 | Top-4 | Top-8 | 备注 |
|---|---:|---:|---|
| 当前 worker | 47/94 | 60/94 | 前一轮冻结基线 |
| BM25 | 45/94 | 57/94 | p50 约 1 ms（前一轮直接检索测量） |
| RRF 混合 | 47/94 | 58/94 | 本轮 top-64×2 有界并集；较先前较窄 RRF 实验不同 |
| RM3-style | 47/94 | 48/94 | 全库排序；总体不优于 BM25/worker |
| MaxSim 近似 | 34/94 | 40/94 | 候选召回 81/94；候选内排序弱 |
| Cross-Encoder | 50/94 | 58/94 | top-32 候选召回 66/94；端到端 p50 约 1.07 s |

关键分片：

| 方法 | unseen Top-4 / Top-8 | unseen p50 | 无名称挑战 Top-4 / Top-8 | 挑战候选召回 |
|---|---:|---:|---:|---:|
| worker | 12/24 / 13/24¹ | 约 0.42 s¹ | 4/14 / 7/14 | - |
| BM25 | 15/24 / 15/24 | 177 ms² | 6/14 | 全库 |
| RRF top-64×2 | 11/24 / 13/24 | 190 ms² | 6/14 / 8/14 | 13/14 |
| RM3-style | 17/24 / 17/24 | 418 ms² | 5/14 / 6/14 | 全库 |
| MaxSim 近似 | 9/24 / 12/24 | 14 ms² | 1/14 / 1/14 | 13/14 |
| Cross-Encoder | 14/24 / 15/24 | 约 1.0 s | 4/14 / 5/14 | 9/14 |

¹ worker 数字来自此前 direct-retrieval 实验，重放时禁用了缓存，计时覆盖完整 worker 路径；与本轮方法不同进程，不是严格同一测量轮次。² 本轮图上实际测得的 `medianMs`。RRF 在本轮采用 top-64×2 有界并集，不能与先前 top-100 RRF（全集 Top-4 32/94、Top-8 40/94）混为同一参数配置。

RM3 的收益集中在 unseen：BM25 的 15/24、15/24 提至 17/24、17/24；但其中有若干完全未召回的目标仅靠扩展词进入长排名（如 92 位、222 位），Top-8 没有相应改善。挑战集反而由 BM25 的 6/14、9/14 降至 5/14、6/14。RM3 p50 是 BM25 的约 2.4 倍，未达到上线门槛。

MaxSim 排序阶段很快，但用句向量模型的 token hidden states 替代 ColBERT 权重，身份命中退化明显；说明“MaxSim 算子”本身不构成 ColBERT 复现。Cross-Encoder 有全集 Top-4 小幅提升，但候选召回限制了上限，约 1 秒 p50 不适合作为每次 Hook 的同步路由。

## 结论与下一步

目前没有一个被测新方法同时稳定提高全集、unseen、专家/Skill/MCP 挑战命中并维持低延迟，因此不改生产路由。可保留 RRF 作为受限候选扩展研究，不当作最终推荐器。

SPLADE v2 需要匹配的稀疏扩展模型权重和 tokenizer；HyDE 需要额外生成模型来产生假设文档。本机当前离线快照里没有这两类模型，也没有可用本地 LLM；忠实运行需要先获得模型文件，不能拿 BM25 或普通向量假装复现。后续最有价值的是取得 ColBERTv2 多语/中文权重、SPLADE 多语权重和可离线运行的 HyDE 生成器，再在同一冻结集、同一候选预算和盲审标注下补测。另需按资源能力做人工盲审，避免 exact-name 标签把等价完整模块误判为错误。

## 工件

- 可复现实验：`scripts/experiment-paper-retrieval-methods.py`
- 逐 query 排名、计时、候选召回、图/数据哈希：`.reports/resource-integration/paper-retrieval-methods-20261025.json`
- Cross-Encoder 逐 query 结果：`.reports/resource-integration/crossencoder-rerank-all-20261025.json`
- 前置 worker/RRF/BM25 对照与根因：`docs/RESOURCE_ROUTING_ROOT_CAUSE.md`
