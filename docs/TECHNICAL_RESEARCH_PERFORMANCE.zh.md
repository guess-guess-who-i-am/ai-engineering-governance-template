# 技术资料检索：批量入口与延时修复

2026-10-22。目标是一次查询多项技术资料、减少模型往返并保留原始证据；不把缓存毫秒级、API元数据条数或组件速度说成实时网页全文与完整回答速度。

后续复测的分层根因、对照结果和本地修复见 [复测根因分析](TECHNICAL_RESEARCH_RETEST_RCA.zh.md)：旧失败发生在模型返回流；显式工具调用已成功，但无需指定工具的自然采用仍未验收通过。

## 1. 本轮实际改动

复用工作区已有的技术资料批量MCP实现，不另搭搜索框架、不引入多Agent或辅助规划模型。一个请求最多20项，覆盖Stack Overflow问题、GitHub仓库、OpenAlex及Crossref论文元数据；复用Node内置fetch的连接池。

确认并修复一个真实排队错误：原实现把缓存读取也安排进GitHub的串行联网队列。另一个慢联网请求存在时，一个有缓存的100毫秒预算请求也会等待到超时，修前回归测试确实失败。现先并行读取缓存，只有缺失项进入联网队列；已命中的内容不会等待无关来源请求或消耗网络槽。修后同一500毫秒慢请求在执行时，缓存查询仍在约11–25毫秒独立完成。

来源限流仍被遵守，GitHub联网调用仍串行；没有改IP、账号或提供方规避限流。一个批次的排队和HTTP工作共享同一个预算，预算到期后保留已完成结果，不让后续每项重新等待完整超时。

补齐客户端fetch发出、收到响应头、读完响应体的区间与峰值，分别记录调度操作数和真实HTTP操作数。缓存命中的HTTP数与HTTP并发为0，不拿缓存文件并行读取冒充网络并发。区间仍包含客户端与网络开销，不是远端服务器内部处理时间。

MCP部分结果不再因某个来源失败就整体标作工具执行失败：成功候选和分项错误一同返回；全部来源失败或全部缓存缺失时仍报错，合法空结果则独立计量。这样避免把单个来源限流变成整批重试。没有静默切换提供方，也没有把部分失败改成全成功。

## 2. 一次多查的真实数据

开始调研时，一次8条查询（4个GitHub、2个Stack Overflow、2个OpenAlex）实时检索2.383秒，返回19条候选；其中两个过长的Stack Overflow查询没有命中。改成短而明确的API查询后，5条查询约1.202秒返回25条候选。条数是API候选元数据，不代表相关性全部正确，也不是25页全文。

最终组件实验一次提交8条、每项最多20条结果：

- `refresh`：1.737秒，8次HTTP、客户端区间峰值7路，7项成功，保留108条候选；其中一个GitHub长查询合法返回0条，Crossref一项HTTP 429，状态为partial。该实验退出码非零，原始负结果保留。
- 后续`prefer`：约348毫秒，7项缓存命中，1项联网补齐，合计128条候选。它不是纯缓存或纯实时实验，也不算前一项限流已永远解决。
- `only`：约34.9毫秒，8项缓存全部命中、HTTP为0，返回128条候选，去重后125条；只把16张选中卡片放入模型可见的MCP返回，其余保留在完整本机证据中。

默认允许的缓存年龄为300秒，读取结果明确保留获取时间和年龄；需要当前实时事实时使用refresh，不把旧缓存叫实时。原始JSON、状态码、条数和哈希都在本机工件中，不将问题摘要冒称答案、不将论文元数据冒称已读全文。

上述都是组件单次样本，不是百分位保证。没有证据声称冷启动、任意实时外网搜索或包含大模型生成的整个任务达到几十毫秒。

## 3. “有入口但模型不用”的实测与修复

未提示并发或工具名称的自然任务：查询Python批量HTTP、Stack Overflow、成熟仓库和并行工具调用论文。第一次模型没有调用批量MCP，而走普通网页搜索，约121.7秒完成。

真实Hook输出把GitHub读资料排成method-github-delivery，而批量资料工具没进前4项。现在移除两个代码投递别名里的泛化GitHub单词；提交、push、PR等明确动作仍保留。加入Stack Overflow、高star、CCF-A、查仓库等能力别名，仍由现有GraphToolCall/词法证据融合，未给所有MCP加类型特权，也没扩展4项上限。

修后同一个自然请求首选technical_research_batch；真实提交/push请求仍首选GitHub交付，原有前端、调试、论文与闲聊硬负例保持。13项真实路由测试通过。别名不是纯词匹配替代语义检索，而是当前索引中的明确能力证据；常驻方法论77条和英文原文未改。

路由修好后的第二个自然任务仍不能报通过：该提供方在发出任何搜索前反复记录流断开、请求失败和超时，240秒被测试中断，MCP调用数和网页搜索调用数均为0。不能把这240秒当搜索HTTP时长，也不能据此宣称模型已自动采用。

本机路由配置已备份、发布，安装策略也登记了新的规则源；检查4个检索进程的图与内存代码版本。沿用工作区已有的模型标识归一化修复及其回归，避免库恢复时移除namespace前缀导致全库重编码；本机本次复用15,527个向量、重新编码0个。新MCP客户端使用1.1.0实现；当前已经启动的旧MCP实例不会因磁盘文件变化而自动热替换，需要新建连接。没有修改模型、提供方、推理档位或密钥。

## 4. 查过哪些依据，采用了什么

- Stack Overflow问题52228550及回答52317307：作者的实际排错涉及长生命周期ClientSession、不要每次请求后关闭。它是社区经验线索，不是通用性能保证；生命周期做法再与HTTPX官方异步文档核对。
- HTTPX官方Async Support文档明确提醒不要在热循环里反复创建客户端，应复用作用域客户端或全局客户端。本实现已有池化fetch，因此没有为了换库再增加Python服务或HTTP客户端包。GitHub检索当时encode/httpx约15,664 stars；star数只帮助寻找成熟实现，不证明正确性。
- requests-cache的session.py实际先get_response并决定是否发送origin请求；借鉴的是缓存快路径与联网分离，未复制第三方源码，也没有启用过期结果兜底。其约1,501 stars不是和大型仓库同一量级的“高star”证明。
- SearXNG约38,713 stars，适合多引擎元搜索，但它的代码抓取本轮超时，不能声称已审过实现；没有把整个搜索引擎装进本机来替代已有入口。
- Kim等《An LLM Compiler for Parallel Function Calling》，ICML 2024，PMLR235，24370–24391：核对了正式会议页面，而不是把arXiv元数据直接当出版版本。借鉴独立调用成批、依赖与执行分离；不将论文最高加速倍数外推到本项目，也没有再加一层规划模型。
- Nishtala等《Scaling Memcache at Facebook》，NSDI2013，385–398：核对USENIX正式页面；借鉴缓存关键路径与可再生成状态的区分，不复制Facebook规模的架构。
- CCF人工智能与网络目录分别核对ICML和NSDI的A类归属。OpenAlex/Crossref的第一条候选本次存在同名/近似标题误召回，工具因此始终将CCF等级标成未验证；作者、正式会议和适用结论由上述一手页面再确认。

本次是工程延时修复，不是撰写新论文，没有为填写清单运行10个无关算法baseline，也没有把Nature/Science/Cell中的无关结果当作实现依据。

一手来源与定位：

- `https://api.stackexchange.com/2.3/questions/52228550/answers?site=stackoverflow&sort=votes&filter=withbody`
- `https://www.python-httpx.org/async/`
- `https://github.com/encode/httpx`
- `https://raw.githubusercontent.com/requests-cache/requests-cache/main/requests_cache/session.py`
- `https://github.com/searxng/searxng`
- `https://proceedings.mlr.press/v235/kim24y.html`
- `https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala`
- `https://www.ccf.org.cn/Academic_Evaluation/AI/`
- `https://www.ccf.org.cn/Academic_Evaluation/CN/`

## 5. 使用、证据与回滚

已有入口：`technical_research/technical_research_batch`，一次传多个source/query，topK决定每项候选数，selectedCount决定返回给模型的候选卡数，不是原始池大小。它只做技术资料发现，决定性仓库文档、Stack Overflow答案和论文正文仍须核验，不能承诺通用网页与任意站点全文。

```powershell
npm ci --ignore-scripts
node scripts/install-technical-research.mjs
node scripts/test-technical-research.mjs
node scripts/test-technical-research-mcp.mjs
node scripts/benchmark-technical-research.mjs
node scripts/test-skill-routing-quality.mjs
```

MCP配置属于用户本机，只注册一个工具；安装器备份并仅修改technical_research段，其他配置保持，重复安装无变化。公开来源无需新增密钥；GitHub/Stack Exchange/Crossref/OpenAlex配额与访问政策仍适用，错误不隐瞒。

运行工件：`.reports/technical-research-20261022.json`及其中引用的用户`.codex/technical-research-cache/requests/`和batches原始JSON。两个自然任务分别位于`.reports/technical-research-natural-20261022/.reports/`与`.reports/technical-research-natural-routed-20261022/.reports/`。来源别名修改前备份位于用户`.codex/backups/technical-research-routing/`；原始日志、缓存、模型、凭据不上传Git。

配置迁移时，在目标机器安装依赖并运行安装器，再刷新全局能力索引；不能只复制本机缓存就声称服务已注册。macOS/Linux本轮没有远程部署或真实重启测试，不宣称全部同步完成。

已通过：真实HTTP重叠、20项输入、重复查询合并、跨调用singleflight共享同一个HTTP请求ID、缓存零联网、缓存绕过慢联网队列、分项失败与原始工件、共享超时与限流回压；真实MCP客户端握手和部分证据不整体报错；13项语义路由、模型空间增量复用回归及完整15项PR门禁。它们不替代上述自然任务的自动采用失败结果。

## 6. 任务树实际落盘回执

以下逐项来自task_tree_write返回的changes，只改ROOT测量状态与根因，没有修改GraphState焦点或执行流。

### 组件修复与首次数据

ROOT / CurrentResult

旧值：

> 已有77条方法论和搜索证据记录保持。新增技术资料批量入口已完成真实HTTP与MCP测试，本机安装并备份配置；4路Stack Overflow、GitHub和论文API实测30条候选约2.38秒，明确标记的缓存读取约2.4毫秒。正反例覆盖限流、超时、局部失败和原始证据；正在接入统一路由并测试模型自动采用，实时外网毫秒级与通用网页提速仍不能宣称达到。

→ 新值：

> 既有技术资料批量入口已复用并修复缓存排队：慢联网任务在执行时，缓存命中仍独立返回，真实HTTP与MCP正反例通过。8条联网查询约1.74秒保留108条候选，其中1条限流明确报部分失败；随后8条缓存约35毫秒返回128条候选且HTTP为零。已核对Stack Overflow、成熟仓库及ICML/NSDI论文；模型自动采用正在实测，不能把技术元数据或缓存命中宣称通用网页实时毫秒级。

ROOT / RootCauseAnalysis

旧值：

> 旧记录只看内层webSearch事件，默认托管搜索不填结构化results，代码模式又将正文放在外层exec/wait输出，因而误判为完全不可记录。现按真实原始事件保存外层返回并单列来源及省略信息；跨多个内层调用的封装只作时间关联，不把它当成逐网页输入回执。

→ 新值：

> 原生网页检索混有模型与读页等待，现按技术资料类型复用直接API批量入口；另发现热缓存也进入GitHub联网队列，导致无关慢请求拖住缓存并超时，已改为先并行查缓存、只给缺失项分配网络槽。部分来源失败曾被整体标成工具失败，现保留成功证据与分项错误，避免诱发整批重试；缓存与真实HTTP并发分开计量。

### 路由验收及外部阻塞

ROOT / CurrentResult

旧值：

> 既有技术资料批量入口已复用并修复缓存排队：慢联网任务在执行时，缓存命中仍独立返回，真实HTTP与MCP正反例通过。8条联网查询约1.74秒保留108条候选，其中1条限流明确报部分失败；随后8条缓存约35毫秒返回128条候选且HTTP为零。已核对Stack Overflow、成熟仓库及ICML/NSDI论文；模型自动采用正在实测，不能把技术元数据或缓存命中宣称通用网页实时毫秒级。

→ 新值：

> 技术资料批量入口及缓存队列已修复：8项联网约1.74秒保留108条候选并明确1项限流，8项缓存约35毫秒返回128条且HTTP为零；真实HTTP/MCP正反例通过。技术查询误排代码投递已改，13项路由通过，77条原文与9份Prompt、22个Skill无漂移。自动采用复测遇模型接口反复断流，240秒中尚未发起搜索；不能宣称端到端或实时通用网页毫秒级。

ROOT / RootCauseAnalysis

旧值：

> 原生网页检索混有模型与读页等待，现按技术资料类型复用直接API批量入口；另发现热缓存也进入GitHub联网队列，导致无关慢请求拖住缓存并超时，已改为先并行查缓存、只给缺失项分配网络槽。部分来源失败曾被整体标成工具失败，现保留成功证据与分项错误，避免诱发整批重试；缓存与真实HTTP并发分开计量。

→ 新值：

> 主要断点是缓存读取被放进GitHub联网队列，以及仅提到GitHub也给代码投递加别名证据，导致快速资料入口被挤出前4项。已将缓存快路径与网络配额分离、收窄投递别名并补技术资料触发；联网与缓存单独计时，局部失败保留成功证据，模型接口断流是当前自动采用验收的外部阻塞。
