# 精准路由：消除泛化资源抢位

## 范围与验收

本次修改本机全局 Skill / 完整专家 / MCP 路由，不改第三方模块正文、图节点关系或 embedding，不按资源名称拉黑，不发布 Git、不修改远端。用户要求自然任务自动推荐，不能依赖用户主动点名。正式安装仅修改Hook与精确能力触发配置；有退步的中文词法候选仅留作可复现实验，不在安装源码或全局worker中启用。

验收分别检查：主题不能冒充明确调用；短词不能匹配英文单词内部；否定、引用和比较不强制置顶；真正指定和通用方法任务不消失；具体文件处理能力不因去泛化而退步。使用真实 Hook 进程、真实全量图和冻结查询；身份 Hit@4 只表示已标注资源出现在前4，不是语义准确率或任务完成率。

## 已复现的第一偏差

旧 Hook 的 `scoreSkill` 和最终合并都用 `query.includes(alias)`，把普通主题别名当成用户明确点名。局部词法分数和图的融合分数原本不可比，代码却让任一主题 alias 无条件消耗一个推荐位置。`CI` 会命中 official/scientific，`UI` 会命中 distinguish/build。明确指定的外部 Skill 还会被 `promptSkillExclusions` 从图结果中删掉。

初始19条真实Hook入口测试仅7条通过；中文纯标点被当词法证据的3项测试有2项失败。测试夹具最初因macOS的 `/var` 与 `/private/var` 实路径差异未连到自己的socket，修正夹具后才记录上述行为失败，不把连接失败当成路由失败。

## 按退步证据修订，而非只看总分

第一轮138查询（原118＋新20）使用8并发：

| 方案 | Hit@4 | 成对改善 / 退步 |
|---|---:|---:|
| 原Hook＋原图worker | 79/138 | — |
| 仅取消宽泛主题抢位等 | 80/138 | 4 / 3 |
| 再从全部文档分词移除标点 | 80/138 | 5 / 4 |

三条共同退步都是PDF文件任务：宽泛主题与精确文件处理能力被一并取消，导致完整PDF入口丢失。整库删除标点还改变了BM25文档长度统计，同时观察到一条业务连接器退步，但不能仅凭同时发生就断定退步由文档归一化导致。这两版没有部署；原始工件保留在 `.reports/router-specificity.json`。

修订规则：

1. alias只用于图候选之后的回退或补空位，不在有图时自动抢位；ASCII alias采用边界匹配，Han可邻接ASCII缩写。
2. 明确调用独立识别：`$name`、`skill:name`、使用结构化名称等；引用、否定、比较和历史提及不获得强制优先。对不确定语句保留正常图检索，不做语义黑名单。
3. 精确能力走 `_capabilityRoutes`，不是放大主题权重。配置要求同一有效分句同时满足“对象领域＋动作＋产物”，并检查排除条件；现配置PDF文件处理，排除PDF库/API实现和规范讨论。规则可扩展，不在排序代码硬编码PDF身份。不修改任何方法论Skill正文或常驻prompt。
4. 另测仅将中文**查询词法证据**中的纯标点归零，保留历史文档统计。该版仍使一条业务连接器退出前4，说明不能把首轮退步简单归因于文档长度改变；查询侧弱词法证据的改变也会重排下游候选。它没有达到本轮零观察退步的安装门槛，已从安装源码撤出，实验通过内存候选模块复现。embedding、图、worker代码及其并发配置本轮都保持原样。

## 正式候选的最终结果

修订Hook加精确能力触发后，同一138任务的名称Hit@4为79→83，4条改善、0条退步。随后收紧判定：**名称和资源类型必须同时匹配**，避免把同名普通Skill当完整专家或MCP算成功。重新通过真实入口运行276请求，结果是：

| 标准 | 原版 | 正式候选 |
|---|---:|---:|
| 前4名称＋类型命中 | 77/138 | 81/138 |
| 完整专家 | 22/48 | 24/48 |
| Skill | 37/58 | 38/58 |
| MCP服务 | 18/32 | 19/32 |
| 原诊断118任务 | 61/118 | 65/118 |
| 新增20任务 | 16/20 | 16/20 |

成对4条改善、0条退步；新增20任务没有改善，不能把旧诊断集收益说成对全新任务已证实泛化。该标准仍是身份与类型代理指标，不是完整工作流成功率。严格结果在 `.reports/router-specificity-release.json`，较早名称口径的实验结果在 `.reports/router-specificity-final.json`；两种口径不混用。

同轮8并发实测Hook入口中位数68.4→73.4ms，p95 989.9→988.0ms；共享缓存、不同请求排队会影响结果，不能说一定提速或延迟完全不变。上下文中位字符数3273→3592.5，**不是节省token的证据**。本轮优先修复相关性，没有引入每请求模型重排、翻译或付费调用。

## 配置契约

`routing-rules.json` 原有 `name: string[]` 仍是主题alias；下划线键保留给配置。新增 `_capabilityRoutes: { name: { subjects: string[], actions: string[], objects: string[], exclude: string[] } }`。前三组每组至少一个非空字符串且组间同时满足；`exclude`可为空数组，命中任一项就不给强制能力优先；无效条目被忽略。目标必须已在本次本地候选中，不能凭配置虚构可用Skill。该配置由安装器复制，Hook消费；缺少新字段不报错。

## 重复出现的候选不等于该删除

138任务里，旧版首位最多是 `establish-test-strategy` 18次、`method-engineering-execution` 17次、`verify-before-completion` 17次。正式候选最多为架构专家团队与Triton各5次，首位分布明显分散。不能以“频率高”判定错误：架构专家可能连续命中架构任务，HNSW调优入口也应在相关任务里重复出现。

图层仍有另一类问题：错误的生成分类、辅助步骤冒充完整工作流、否定内容进入语义候选。上轮已核验 `cpu-gpu-performance` 是资源基线/节流辅助，不是完整服务负载诊断；`apm-performance-expert` 有腾讯APM等前提；`researchers-verifier` 不是完整并行研究团队。这些不能靠Hook去泛化宣称全部解决，后续需要有来源的动作/产物/依赖表示与独立语义评审。完整原模块保持不拆不改。

## 验证与复现

- `scripts/test-router-specificity.mjs`：并发调用真实Node Hook，覆盖点名、否定、引用、短词、外部资源、精确能力与回退。
- `scripts/test-routing-tokenization.py`：实验候选的纯标点零词法证据、Han边界、文档统计保留；4项通过不代表整体检索非劣，该候选不部署。
- `scripts/compare-router-specificity.py`：同一19753节点图，原Hook与修订Hook共享线上worker；分词修订另用单个隔离worker，对相同138任务做对照，两个不同工作区交替输入。标签不参与排序。
- `.reports/router-specificity-final.json`：修订后对照，结果以实际生成工件为准。
- `scripts/compare-router-specificity.py --hook-only --report .reports/router-specificity-release.json`：只比较最终可安装Hook，不加载未部署的分词实验。
- `scripts/verify-router-specificity-installed.py`：从已安装全局路径复核批准的138个输出、资源类型、两工作区以及worker未重载；证据写入 `.reports/router-specificity-installed.json`。

已有worker16项、资源图6项、查询缓存3项、可移植传输8请求和macOS安装/路由/回滚集成已通过。集成首跑误把真实Python覆盖了夹具Python导致走入不适用的模型准备，停止自建测试进程后用原夹具重跑通过；未操作生产worker。对照首跑隔离目录缺少Python路径而失败，补正确依赖路径后重新完整运行，不计作成功请求。

时延为8并发下的实际观察，不是严格等缓存/等进程的提速证明。上下文字符数不是LLM token；未使用付费模型，也未完成独立盲评LLM门禁、业务任务成功率或主模型token消耗验证。`scripts/verify-repository.ps1` 在此仓库不存在，不能声称执行；不对无关脏文件重复全量发布门禁。

依据沿用已核验原文，详见 `docs/RESOURCE_ROUTING_MECHANISM_EXPERIMENTS.md`；本轮重查Elastic的standard tokenizer官方说明。Stack Overflow原整词边界答案地址本轮返回Cloudflare验证页，未把它算作新读取成功。

## 本机全局部署回执

正式Hook已同步至 `~/.codex/hooks/skill-router.mjs`，SHA256为 `afd6e6baa3cdb24d46f031d2884dcf6047c173830d1b25e1b0a6e2b80406c5c6`，与仓库安装源完全相同。全局规则只新增精确能力字段，保留用户原有主题alias；未重装整套配置、未改凭据。安装源码与全局indexer仍为原SHA `b583e7d614806904ebeb031f30b87bd8cc5d46635738e83b4c954230cd1b7224`，全图SHA仍为 `9311c0e7e441a4ca04cb7ddec0966416f0186ec751bf4f7b95b892760c40da41`。

安装后两个工作区交替、8并发复核138次，名称和类型输出138/138与批准候选相同。worker前后均为PID51937、加载1次、英中文均预热、候选池开启。没有重启或关闭worker，下一次Hook调用使用新文件，不要求重启Codex。全机重启未测试。

实际 `hooks.json` 配置指向全局 `hook-dispatch.mjs`，并非只测孤立函数。使用其中固定的应用内Node运行该dispatcher，输入中文HNSW内存/召回/延迟调优任务，成功返回路由段、无stderr，候选依次为 `vector-index-tuning`、`database-operations`、`memory-hygiene`、`context-hierarchy-design`。首位正确，但后两项仍有领域错配风险，这正是尚未解决的图层弱排序，不能把Hook抢位修复说成全体候选都精准。该冒烟测试没有实际执行调优Skill或让主LLM完成业务任务。

全局Hook自身27条入口反例＋3条回退控制、资源图6项、worker16项、安装集成再次通过；新Hook边界测试与资源图测试已加入CI配置，但本轮未在远端CI运行。任务树ROOT只更新当前测量、根因与下一步，没有改GraphState、边或执行顺序；compact工具与shell门禁通过，流程状态报告本项目没有执行流程脚本，不需新增。Git全量差异检查仅发现两个既存非本轮文档的尾空行；本轮触及的已跟踪文件差异检查通过。未提交或推送Git。
