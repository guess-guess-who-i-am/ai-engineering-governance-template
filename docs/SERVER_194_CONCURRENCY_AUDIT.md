# 194 服务器并发排查与修复

核查日期：2026-10-18。目标：解释本机与 192.168.4.194 的差异，修复可确认的配置回退；不把脚本能运行或配置值变更当作真实任务已提速。

## 第一阶段结论（部署前快照）

后续部署已补齐全量图和常驻服务，并通过正式界面完成两个Hook的信任，无需用户重复操作。最新运行状态与压测见 [194全局worker部署](SERVER_194_GLOBAL_WORKER_DEPLOYMENT.md)。以下保留第一阶段的诊断证据，不代表部署后的现状。

已修复服务器主动关闭多 Agent 的配置与两个生成源。运行端重新读取配置后确认开启、上限20；两个全局 Hook 仍为 modified，必须由用户重新确认信任。没有修改 trusted_hash、绕过信任、重启服务器或中断已有任务。尚未完成真实 LLM 调度和整体响应速度的复测。

## 已确认的差异

| 边界 | 本机 | 194 |
| --- | --- | --- |
| 配置库分支/版本 | codex/macos-global-deploy，0cd7d48 | codex/stable-hook-dispatch，6e650a9 |
| 检索部署 | 4个常驻进程、15511工具的图 | 无图worker脚本、Python运行环境或图文件，注册表仅28条 |
| dispatcher内部路由截止时间 | 60秒 | 12秒，尚未迁移 |
| 固定提醒 | 三轮一次 | 旧实现每轮；当前信任问题未解决 |
| 多Agent | 已开启，上限20 | 原关闭；本次恢复开启，上限20 |

这不是同一套配置已部署后仅服务器算得慢；Git分支、安装源、运行配置和Hook信任之间缺少目标机验证闭环。此前macOS一键部署明确只支持macOS，不能推断Linux已同步。

## 排除与保留的解释

- 旧完整Hook三个独立请求并发手测：0.398、0.429、0.414秒，均返回路由和提醒，无stderr。因此“每次图检索很慢”不能解释这次观测：194根本没有本机那套图检索。
- 用实际运行的0.160.1二进制通过hooks/list读取：SessionStart、UserPromptSubmit均enabled，但trustStatus都是modified。近期抽样对话未见全局提醒/路由注入标记。这支持Hook信任断点；并未独立捕获一次被拒执行事件，因此不把日志缺失当作所有历史任务都没执行的证明。
- 运行端生成的schema说明additionalContextLimit=0表示关闭溢出分流，不是丢弃上下文；本次未把它当作故障，也未改它。
- 最近抽样真实对话中已有Promise.all批量调用；只有一个外层exec，不代表里面串行。
- 个别模型请求输入约15万至21万token，工具操作间隔也可能较长；没有进行可比的模型/网络基准，不能把这些时间全部归因于上下文、API或CPU。
- 服务器40个可用CPU，初测可用内存约41GiB，swap已用满；仅凭swap存量不能认定当前发生换页瓶颈。本次未使用GPU，未清理或终止其他任务。

## 本次变更与证据

1. scripts/configure-codex-concurrency.mjs：仅合并features.multi_agent、agents.enabled和agents.max_concurrent_threads_per_session；默认只检查，显式--apply才修改。私有备份、幂等、拒绝歧义配置、锁与符号链接保护；不输出原始配置、改Hook信任或覆盖provider/MCP。
2. 194旧分支的repair-codex-linux-config.mjs：不再关闭多Agent，保留agents表；configure-lazy-capabilities-linux.mjs及其full-tools配置同样保持开启。可复用源码补丁保存在patches/linux-concurrency-config.patch，应用前必须git apply --check；不需要把整个旧分支覆盖到本机。
3. 先运行test-linux-concurrency-generators.mjs，旧实现明确失败：配置修复脚本关闭multi_agent且删除20并发设置。修复后它与原有test-repair-codex-linux-config.mjs、test-configure-codex-concurrency.mjs通过。最后--check返回current，无漂移。
4. 0.160.1运行端config/read确认multi_agent=true、agents.enabled=true、max_concurrent_threads_per_session=20；模型仍gpt-6.1-sol，推理强度仍high。没有重启共享daemon，因此不能据此保证已经运行中的会话重建了工具集。
5. 4个独立子进程各执行约200ms有限计算，4/4成功，峰值真实重叠4，总耗时373ms。这只验证进程并行基础能力，不是LLM自主调度基准，不能宣称20个Agent或100个检索请求已在194通过验证。

备份：服务器/home/hyf/.codex/config.toml.before-concurrency-9b95ea80-ab6c-4108-83f3-2f7f2891fe16；位于服务器用户私有目录，不复制进Git。本次未提交或推送，保留原有未提交改动。

## 第一阶段的下一步与限制（后续已推进）

用户需在连接194的Codex中审阅并重新信任上述两个全局Hook，再开一个新任务，确认真实注入和独立工具执行区间重叠。不要为了刷新配置重启整台服务器或中断其他会话。获得信任确认后才有条件做真实新任务提速验收。

全量Skill库、embedding、常驻池、自动刷新及Linux可复用安装仍未迁移；不能把本次开关修复说成整套图路由已部署。没有改变自动压缩阈值、推理强度或API来源；这些会影响质量与服务行为，需可比证据再决策。

官方OpenAI文档返回403、搜索请求超时，Stack Overflow返回访问验证页，因此未将外部检索结果作为依据；使用实际二进制生成的schema、只读RPC、真实文件与可复现测试交叉核验。仓库Skill要求的scripts/verify-repository.ps1不存在，未声称完整PowerShell门禁通过。

## 任务树逐字段回执

以下旧值与新值直接取自task_tree_write的持久化changes，不推测未发生的修改。未修改GraphState或执行流程。

### 诊断记录

- ROOT · CurrentResult

  旧值：macOS全局检索已部署4个常驻进程，仓库与安装文件一致；独立复核100个不同长请求的完整Hook突发、错峰及冷启动均100/100成功，P95约28.9、25.2、40.8秒。11项worker回归通过；100请求可用，但低延迟、三轮提醒长期质量和跨Mac重启仍有验证或优化缺口。

  → 新值：macOS全局4进程检索已通过100请求突发、错峰及冷启动复核，P95约25–41秒，见docs/GRAPH_WORKER_VALIDATION.md。194服务器仍在旧分支，缺少全量图和常驻worker，两个全局Hook被运行端标为修改后未信任，且多Agent关闭。194旧Hook手动运行约0.4秒，真实任务变慢尚未修复，不能宣称跨机器部署完成。

- ROOT · RootCauseAnalysis

  旧值：原单连接、大锁和Hook重复扫描外部全库导致排队；embedding重排绕过缓存和互斥，Metal并发会崩溃。现用4进程池、图版本缓存、在途请求合并及CPU模型缓存，并删去每轮重复外部注册表。

  → 新值：Git提交与目标机运行态没有部署闭环：194仍使用另一分支的旧配置，Hook修改后信任记录失配，常驻全量检索未安装。服务器部分调用已有批量执行，长上下文与模型响应耗时仍须和工具执行分别验证。

- ROOT · NextIdea

  旧值：持续监测真实长任务和完成检查的检索延迟、失败率与缓存命中，并在另一台Mac验证重启恢复和三轮提醒质量。

  → 新值：恢复194并发配置，由用户重新信任Hook后，在新任务中验证实际注入与工具重叠，再决定全量图迁移。

### 修复后记录

- ROOT · CurrentResult

  旧值：macOS全局4进程检索已通过100请求突发、错峰及冷启动复核，P95约25–41秒，见docs/GRAPH_WORKER_VALIDATION.md。194服务器仍在旧分支，缺少全量图和常驻worker，两个全局Hook被运行端标为修改后未信任，且多Agent关闭。194旧Hook手动运行约0.4秒，真实任务变慢尚未修复，不能宣称跨机器部署完成。

  → 新值：macOS全局4进程检索通过100请求复核，P95约25–41秒，见docs/GRAPH_WORKER_VALIDATION.md。194运行端已读到20上限与多Agent开启，两个会关闭并发的生成脚本已修复，回归通过且4进程真实重叠。两个全局Hook仍须用户重新信任，全量图与常驻worker尚缺，不能宣称194真实任务已提速。

- ROOT · RootCauseAnalysis

  旧值：Git提交与目标机运行态没有部署闭环：194仍使用另一分支的旧配置，Hook修改后信任记录失配，常驻全量检索未安装。服务器部分调用已有批量执行，长上下文与模型响应耗时仍须和工具执行分别验证。

  → 新值：194使用另一分支的旧配置，Linux修复与懒加载脚本会关闭多Agent并抹去并发设置，Hook修改后又与信任记录失配。旧Hook手测约0.4秒且部分任务已有批量执行，长上下文与模型响应耗时不能归因于图检索串行。

- ROOT · NextIdea

  旧值：恢复194并发配置，由用户重新信任Hook后，在新任务中验证实际注入与工具重叠，再决定全量图迁移。

  → 新值：用户在194连接中重新信任两个全局Hook后，用新任务核验注入、实际工具重叠与响应耗时，再推进全量图迁移。
