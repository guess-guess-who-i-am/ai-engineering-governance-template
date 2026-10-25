# 首次候选结果的独立语义相关性审阅

2026-10-24。只读审阅 `.reports/resource-retrieval-candidate.json` 的 candidate 首次结果，逐条检查 query 与原顺序 top4 的图节点描述，并抽读有歧义的实际入口。未读取 expected 字段，未使用目标排名或精确名称成功标志判分；未改标签、排名、原始结果、图或代码。本审阅不是检索改良实验。

完整逐条理由、候选区分和限制在 `.reports/resource-integration/retrieval-relevance-review.json`。输入 SHA-256：`619d74a5b8d7cbdd891ded767927f3a9384cc2f331fc57f485ba0ae90e12610e`；候选图 SHA-256：`f3440f133ee392a0195388189796f63544b635a921569409c10f376ba3dec024`。

## 判据与校准

先校准两个明确案例：PDF 文字提取请求匹配“读取PDF并提取文字”的入口，判相关；Notion工作区检索请求匹配旅行预算入口，判不相关。相同动词、常见名词或“存在合法文件”不足以证明相关。

- 完整覆盖：top4 至少一个入口覆盖请求主动作，可以是功能等效替代，不要求命中特定名称。
- 部分覆盖：只解决子步骤，或者限定了不同的项目/领域，不能当成完整模块替代。
- 不覆盖：没有入口支持目标系统及主要动作。

语义相关与操作可用性分别判断。Skill、完整专家适配入口、MCP描述符都可以被检索；但文件存在、描述相关、tools/list成功均不证明宿主映射、登录、脚本、业务权限或收费条件已满足。

## 逐条结论

行号对应原 candidate.rows 的零基编号，原顺序未变。

| 行 | 请求主题/语言 | 结论 | 主要依据与边界 |
|---:|---|---|---|
| 0 | 并行研究报告/英 | 完整覆盖 | go-in-depth 原文有5并行搜索、去重、对抗核验和引用综合；Workflow宿主未核实 |
| 1 | 研究团队/中 | 完整覆盖 | gpt-researcher-team 完整七角色流程；强制PASS不能当验收 |
| 2 | 架构部署安全团队/英 | 部分覆盖 | oma-architecture 是架构决策方法，排除安全审查；其余是CI/CD或Agent架构方法，不是完整交接团队 |
| 3 | 架构部署安全团队/中 | 完整覆盖 | aicoding完整团队直接覆盖；仍有宿主路径问题 |
| 4 | API突发压测/英 | 部分覆盖 | performance-optimization 有测量、定位、验证，但不明确设计真实突发负载；增长黑客不相关 |
| 5 | API突发压测/中 | 完整覆盖 | api-testing-expert 原文有真实流量、负载/压力/耐久和瓶颈分析；未执行本条 |
| 6 | 需求到测试设计/英 | 完整覆盖 | aladin-test-design/test-cases覆盖结构化用例；追溯矩阵可补充，非执行测试 |
| 7 | 需求到测试设计/中 | 完整覆盖 | test-design与完整aladin专家均相关；音频转录是噪音 |
| 8 | 并行TDD双评审集成/英 | 部分覆盖 | code模块缺显式完整双评审链；implement-spec绑定Open Mercato且主要自审；数值积分是噪音 |
| 9 | 并行TDD双评审集成/中 | 完整覆盖 | dev-pipeline-orchestrator 原文直接描述该链；不等于本query已执行 |
| 10 | 论文英译润色/英 | 完整覆盖 | paper-polish 实际正文有中译英、科学含义保留与不编造公式引用，图描述丢了这些细节 |
| 11 | 论文英译润色/中 | 完整覆盖 | academic-translation直接匹配；基金摘要不等同全文论文 |
| 12 | 本地登录测试/英 | 完整覆盖 | dev-browser/playwright支持浏览器测试和截图；运行依赖未核实 |
| 13 | 本地登录测试/中 | 完整覆盖 | webapp-testing明确本地应用、截图、浏览器日志；WeData平台不相关 |
| 14 | PDF文字表格提取合页/英 | 完整覆盖 | kdocs完整模块有读取、转换、页面提取与合并；表格保真、认证、成本未测 |
| 15 | PDF文字表格提取合页/中 | 完整覆盖 | kdocs与nested pdf-toolbox的实际工具表匹配；纯reader只覆盖部分 |
| 16 | Excel公式格式重算/英 | 完整覆盖 | xlsx描述明确公式、格式、保留和重算，仍属完整父专家包 |
| 17 | Excel公式格式重算/中 | 部分覆盖 | Excel Automation能创建/格式化，但公式示例主要是Google Sheets，Excel重算闭环未建立 |
| 18 | 旅行预算取舍/英 | 部分覆盖 | travel-itinerary-data只有部分预算和固定数据集约束；云FinOps、工程造价不是旅行取舍 |
| 19 | 旅行预算取舍/中 | 完整覆盖 | budget-balance语义直接匹配，但状态known-helper-failure，不能宣称可运行 |
| 20 | 版本化库文档/英 | 完整覆盖 | context7-mcp-skill原文是Context7适配器，等效入口；uxc依赖未核实 |
| 21 | 版本化库文档/中 | 完整覆盖 | context7描述与发现工具匹配；grep_app不等于版本官方文档 |
| 22 | GitHub issue/PR连接器/英 | 完整覆盖 | GitHub服务描述符与issue/PR相关Skill；认证与发现尚需完成 |
| 23 | GitHub issue/PR连接器/中 | 完整覆盖 | github-operations实际通过mcporter调用mcp-github，属等效入口；其余三个是股票、牙科、微博噪音 |
| 24 | Notion检索读取/英 | 完整覆盖 | Notion服务明确搜索页面读取；Knot是不同系统，不能替代 |
| 25 | Notion检索读取/中 | 不覆盖 | 闪剪、飞书幻灯片、予非知识库、wolai都不是Notion |
| 26 | 社保福利连接器/英 | 完整覆盖 | 51shebao为社保公积金政策/缴费查询，erhao为HR服务；“找到候选”不是已办理业务 |
| 27 | 社保公积金连接器/中 | 完整覆盖 | ihr-insurance实际走ihr-cli服务查询社保/公积金，不是已验证MCP；需共享Skill及权限 |

28条中，22条top4具有语义上覆盖主动作的入口、5条只有部分覆盖、1条明显不覆盖；英文完整覆盖10条，中文12条。这个计数是单个LLM按上述判据的相关性解释，不是任务准确率、执行通过率或统计泛化结果。

## 对路由的实际含义

精确名称没命中不一定没有可用方法：go-in-depth、paper-polish、context7-mcp-skill、github-operations都是实例。反过来，top4含新模块不代表相关：增长黑客不能替代API压测，云FinOps不能替代旅行预算，wolai不能替代Notion。

至少两个独立问题仍然存在：英文完整团队查询有时只召回片段方法；中文专有服务名虽保留在query中，仍可能被“页面、连接器、查询”等泛词带偏。原有15k库的描述也有噪音，例如 go-in-depth 被附上ARIA标签、oma-architecture被归到内容写作；这不改变原方法，但会影响语义候选池。此轮只记录现象，未修改索引或描述。

完整模块的正确入口与运行健康也必须分开：budget-balance的语义匹配很好，却已有helper失败；Notion/GitHub描述符尚需授权；ihr-insurance是相关CLI入口但不证明服务已装配。因此不能拿22条相关计数宣传为22条已成功解决。

## 限制

单LLM审阅，无人工仲裁或多审阅者一致性测量。所有top4节点描述已检查，仅必要少量实际入口抽读，未人工读完所有附属文件。旧库返回的名称可能多义，例如deep-research对应三个节点，首次输出缺唯一节点ID，因此没有将该歧义候选单独当作可靠证据。没有调用业务服务、付费API、修改账号、安装依赖或执行这28项任务。

## 语义候选池约束版本：三个变化例的追加审阅

另读 `.reports/resource-retrieval-semantic-guard.json`，SHA-256为`edf2dcd639c340aa07ece8e53be0675da0a75067f004da5e18264eec68346cde`。只比较指定三条，首轮28条结论保持原样，不据此推算新版整体相关率。

| 请求 | 首轮top4→约束版本top4 | 独立判断 |
|---|---|---|
| 中文论文翻译 | `ml-paper-writing / nsfc-abstract / academic-translation / dissertation-polisher-zh` → `ml-paper-writing / nsfc-abstract / paper-polish-workflow / translation-localize` | 完整覆盖→部分覆盖。新翻译入口有术语、格式、占位符质检，但全文没有学术公式与引用保留契约；论文写作和润色方法不能自动拼成完整学术翻译模块。这不是只按特定名字掉出判失败。 |
| 中文PDF提取与合页 | `pdf-reader / kdocs-pdf-toolbox / pdf-to-markdown / pdf-toolbox` → `pdf-reader / agentearth-image-ocr / kdocs-pdf-toolbox / pdf-to-markdown` | 仍完整覆盖。完整父专家kdocs-pdf-toolbox还在top4，内部保留同一个pdf-toolbox及其提取合并能力；子Skill名排名下降不等于能力丢失。新增OCR明确不支持PDF，是噪音。 |
| 英文社保福利连接器 | `benefits-by-country / erhao-hr / malaysia-hr-admin / 51shebao-hr-tools` → `malaysia-hr-admin / benefits-by-country / erhao-hr / hr-digital-expert` | 完整覆盖→部分覆盖。仍有HR连接器，不是全无相关入口；但erhao当前描述仅人事/组织/考勤/薪酬，未确认社保福利，马来西亚专家是知识咨询，腾讯HR专家是数仓/开发。较原明确社保公积金查询描述，业务覆盖证据减弱。 |

这些变化说明，严格名称统计上升不保证所有实际请求改善；也不能反过来把所有名称下降认定为退化。PDF例子恰好说明完整父模块可以是更符合用户意图的入口。仍应保留真实首次结果和增退案例，不以补特定标签或刷100%名字命中作为验收。
