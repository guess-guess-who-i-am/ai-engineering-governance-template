# 专家推荐：评价与长追问修复

已修复并全局部署长追问丢主题；已提供逐席、逐必要能力的证据评价器。**尚未达到“给出需求即可快速、稳定找到契合专家”的整体目标。** 不再将49/68等预设名字命中解释为推荐准确率。

本轮沿用完整test-results-analyst入口的“数据核验→模式分析→风险判断→报告”流程；实际交付为下面的逐席评审、失败模型校准和部署证据，没有声称构建预测模型或获得独立统计置信度。

## 根因和实际修复

1. 旧指标只检查任一目标名进入两席，错误搭档、未标注的等价专家、运行阻断与真实产物均未进入判据。新评价分别记录直接适用、局部辅助、无关、待判断；每项必要能力附原角色引文，运行条件和实际执行独立记录。原模块ID、原角色哈希、冻结任务、真实两席和评审绑定必须一致。引文存在不等于语义判断必然正确。
2. 查询构造将95字真实追问当独立请求；短词白名单及100字上限无法恢复指代对象。现在沿有界会话尾部找到最近实质任务，保留最新约束和完整当前输入。历史仍限1600字符、读取仍限1MiB；显式换题、自带问题和引号中的指代分别检查。有限规则仍不能保证理解全部自然语言指代。
3. 恢复主题后，447个专家中，本次6个追问仅有3–12个专家进入最终评分；相关角色仍可能遗漏，词面/向量相近也不等于能完成产物。隔离实验表明，读取原角色并扩大类内召回能找到更契合角色，但代价高，不能把该组合的改善归于其中一个变量。

生产仅替换全局skill-router.mjs，使用临时文件原子重命名。图、catalog、专家原包、dispatcher、hooks.json与信任配置未改，worker没有重启。2专家＋4 Skill＋2 MCP不变；没有部署任何新重排模型，也没有安装新依赖或调用付费API。

## 同图实测

8场景各运行baseline、candidate、anchorOnly，24次真实Hook，最大4个客户端实际重叠。两个换题控例输出不变；anchorOnly是因果诊断，不能用于生产忽略当前请求。实验使用驻留图缓存，耗时不能当冷启动速度或整个agent提速。

6个追问的两席原角色逐项审阅如下。审阅由当前主模型完成，能看见名字与方案，**不是独立盲评或总体准确率**。

| 指标 | 旧查询 | 新查询 |
|---|---:|---:|
| 有直接适用专家的任务 | 2/6 | 4/6 |
| 直接适用席位 | 2/12 | 5/12 |
| 无关席位 | 9/12 | 6/12 |
| 待判断席位 | 1/12 | 1/12 |

事故与数据库追问改善；评价、安全仍未修好。SOE对业务租户授权修复的证据不足，保留待判断。运行就绪和业务专家工作流均未验证，不能将0个已验证成功说成真实成功率0%。

## 模型和召回对照

全部实验离线、免费，不写生产图；类内深度实验始终保留总池上限500，输出配额不变。下面是实际返回角色及耗时诊断，不给名字直接贴“正确”标签。

| 方法 | 重排中位耗时 | 观察 / 决策 |
|---|---:|---|
| mMARCO MiniLM，原池、索引描述 | 约0.64秒 | 评价仍招聘/绩效，安全仍SOE/CPQ；不部署 |
| mMARCO MiniLM，类内深度50、索引描述 | 约4.18秒 | 事故出现合同/RTC等错配；不部署 |
| Qwen3-Reranker，原池、索引描述 | 约1.67秒 | 评价仍招聘，安全仍截图取证；不部署 |
| Qwen3-Reranker，原池、原角色 | 约2.82秒 | 评价仍招聘，安全仍SOE/账号管家；仅换正文不够 |
| Qwen3-Reranker，类内深度50、索引描述 | 约11.62秒 | 带入测试分析、应用安全专家，但评价首席仍招聘；不部署 |
| Qwen3-Reranker，类内深度50、原角色 | 约24.6秒 | 出现模型质量审计、应用安全、SRE等更契合角色；过慢，不部署 |

Qwen的召回深度×文档字段四格对照已补齐。只换原角色、保留原池，评价/安全仍错；只加深类内召回，安全能找到应用安全专家，评价仍保留招聘首席。两项一起改变才在评价/安全同时出现更契合角色，但仍有不必要搭档且速度代价最大。这是6个开发追问上的机制证据，不是对全部任务的保证。

组合实验中模型质量审计专家明确覆盖ranking/recommendation、标签质量与指标审计；另一个Skill Smith主要制作/审查Skill包，不能直接视为本任务两席均适用。安全专家覆盖授权、威胁建模、修补与验证；腾讯安全专家要求内部知识库，未验证该运行前置条件。不能只凭语义看起来相关声称实际已能执行。

另以Qwen3-0.6B本地生成模型校准12个来源明确的scope例，最终仅5/12匹配。模型会给direct标签却在理由中说不相关；拒绝用于生产排序或自动验收。期望标签仍由当前主模型根据来源编制，不能当人类金标准。初次多行frontmatter提取误读为竖线的结果已作废，保留本机失败报告。

## 验证与复现

- 新上下文测试对旧Hook复跑出现5项缺主题失败，对新Hook13例通过；相邻短追问、secret排除、1MiB尾部、上下文预算、2/4/2配额通过。
- specificity原安装即因过时文案断言失败；改查原入口/原流程责任，保留27项选择断言及3项无图控例，并将27进程齐发改为4路有界。专家入口8项字节/路径/歧义测试通过。
- 逐席评价器10项测试通过，包含错误搭档、等价角色、未知、部分互补、伪造引文、任务/模块错绑、同键但不同含义的任务约束和伪成功等反例。机械校验不替代评审校准。
- 仓库外两个工作区读全局Hook和原角色成功，447个入口中446 ready、1 blocked、0 stale；这是入口完整性验证，不是447个业务执行成功。
- 仓库外真实dispatcher的数据库长追问调用成功，返回两位数据库专家；约221ms只是一条缓存请求，不是总体性能结论。没有启动客户端新LLM轮次，不能据此证明未来轮次已审阅Hooks。
- verify-before-completion Skill引用的scripts/verify-repository.ps1在本仓库缺失，搜索未找到同名入口，不能声称执行过；采用仓库实际入口scripts/check.ps1。其15项完整PR门禁通过。它验证仓库治理合同，不证明专家语义推荐正确。

```sh
node scripts/test-router-context-continuity.mjs
node scripts/test-router-specificity.mjs
python3 scripts/test-expert-applicability.py
python3 scripts/evaluate-expert-applicability.py --review docs/evidence/expert-applicability-review-20261030.json --run docs/evidence/expert-continuity-run-20261030.json --report /tmp/expert-applicability-summary.json
```

真实重跑对照需使用旧Hook实验文件作为baseline：

```sh
node scripts/benchmark-router-continuity.mjs /path/to/old-skill-router.mjs /tmp/continuity-run.json
```

模型诊断入口为scripts/experiment-continuity-rerank.py；参数--model必须指向已缓存模型，可切换--original-role及--category-depth。需要已部署全局图和graph-tool-call环境；不自动下载模型。脚本中的候选及分数不构成相关性标签。

证据：[真实两席与时间区间](evidence/expert-continuity-run-20261030.json)、[逐席评审](evidence/expert-applicability-review-20261030.json)、[汇总](evidence/expert-applicability-summary-20261030.json)、[重排实验](evidence/expert-rerank-probes-20261030.json)、[失败评审校准](evidence/expert-judge-calibration-20261030.json)。原始日志和失败stdout/stderr在本机.reports/expert-repair-20261030/，未复制完整第三方角色进仓库。

## 外部依据

- [ConQRR，EMNLP 2022主会](https://aclanthology.org/2022.emnlp-main.679/)：已读原文§4.3，同主题历史可能有益、换题时盲拼历史会退化。借鉴会话边界对照，没有复现其RL训练。
- [ZeCo2，SIGIR 2022](https://github.com/littlewine/ZeCo2)：已读方法与原文，历史上下文化当前query token，仅当前轮参与MaxSim。当前没有ColBERT token矩阵，不能把拼接单向量称为复现。
- [umBRELA](https://github.com/castorini/umbrela)：已读原始等级提示，相关但不回答与真正回答区分；借鉴分级，不照搬其分数或声称其60星为高star。
- [Stack Overflow回答79883529](https://stackoverflow.com/a/79883529)：已读输入与chat_history的shape约束；是接口证据，不是当前有限词表问题的直接修复。
- [mMARCO模型卡](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1)：已读原文，该模型训练于翻译版MS MARCO，支持query/passage重排；文档检索效果不能直接迁移为专家适用性。
- [LangChain](https://github.com/langchain-ai/langchain)元数据确认是高star维护项目，但尝试的history-aware源码地址均404，因此未将未读取实现作为修复依据。原始失败保留，未用仓库声誉替代源码证据。
- [上一轮指标审计](EXPERT_METRIC_AUDIT_20261030.zh.md)保留ToolSandbox和MT-Bench依据及局限。

尚无整体任务成功率、总token消耗或整个agent加速的可用对照；不能宣称已经比空Codex快或优于另一模型。下一关键缺口是以较低成本保留原角色领域/产物约束的召回与排序，以及独立校准后的任务产物验收。
