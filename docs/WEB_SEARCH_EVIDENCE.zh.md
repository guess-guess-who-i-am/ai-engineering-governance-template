# 搜索返回内容记录与验收

2026-10-21。用户要求是记录搜索到底返回多少内容、哪些内容给了模型，并实测，而不是只记调用成功。

## 已实现的入口

`scripts/test-codex-hook-runtime.mjs` 现在默认在隔离临时会话开启实验性原始事件，接入 `scripts/web-search-evidence.mjs`。没有修改用户全局Hook、Prompt、模型、账号或搜索提供方，也没有给每次用户消息增添正文日志。

每次测试在运行目录的 `.reports/` 下生成：

- `web-search-evidence.json`：逐调用查询、条数、来源、内容长度、SHA-256、原文路径、可见性和省略状态。
- `web-artifacts/*.results.json`：接口确实暴露的结构化结果，保留未知字段；空数组和未返回分开记录。
- `web-artifacts/*.output.json` / `*.output.txt`：直接搜索工具输出；有正文才生成，写入时不截断。
- `web-artifacts/envelope-*.json` / `*.txt`：代码模式下实际返回的exec/wait外层输出，完整保存并单独计量。它可能包含多个工具结果或轮询状态，不假装属于单个网页。
- 原有完整测试结果和经过原始事件筛选的事件文件仍保留；额外记录所有验收失败原因，避免后一个错误覆盖前一个错误。

非网页原始消息、加密推理和无关原始输入不写入新增原始事件日志；没有读取或打印凭据。原始搜索工件只在本机生成，不进Git。记录器保存的是模型侧可见工具输出工件，不是服务端收到的下一轮请求回执，更不是“模型全部理解或使用”的证明。

## 真实测试结果

最终隔离会话 `01a15c97-3d9f-7c62-8b42-c5f90cb8d4d2` 的请求是“请搜索MDN Promise.all的失败处理说明，给一条结论和来源”，没有告诉模型批量或限制回答长度。搜索事件1条查询，耗时7.208秒；整体42.097秒。

实际外层exec返回 **5226个Unicode字符、6700个UTF-8字节**，包含工具完成状态与结果正文；SHA-256为 `77a7b1230044f65cfc6aa7326c0056a79037c82acd602d2ffccdc49851ca3724`。已完整保存且校验，不依靠最终回答自述。

输出明确列出3个Source URL：同一Promise.all文档的简体中文、英文、繁体中文。这里的“3”是该可见输出列出的3个来源URL，不是搜索引擎全量召回数；它们也不是3篇独立主题文档，存在多语言重复。

正文自称摘录，末尾明确提示有内容不可用或因策略/输出限制被省略。因此 `contentForm=source-excerpts`、`upstreamContentOmitted=true`；记录器没有再截断。不能据此区分究竟是抓取失败、策略删减还是长度裁剪，也不能说拿到3页完整原文。

本机真实工件目录：`.reports/search-envelope-audit-20261021/.reports/`。正文：`web-artifacts/envelope-212d1f2c835656af1350ca48.txt`；清单：`web-search-evidence.json`。最终回答110个可见字符。结构化results依然未暴露，严格全链路检查仍返回失败，这一负结果没有改成通过。

## 根因与协议依据

1. 旧记录器只保留webSearch的action，根本没保存它的results字段。
2. 当前Codex 0.163.0-alpha.10.2生成的协议说明，results是独立搜索的带外结构化结果；默认托管web_search_call可能只回动作元数据。空值不代表搜索没有结果。
3. 当前会话可通过代码模式调用搜索：主模型的原始调用是custom_tool_call形式的exec，再由wait收结果。网页正文位于外层custom_tool_call_output，不在内层webSearch.results里。记录器现在支持两类原始工具调用与外层封装，避免少解析一种形态。
4. 本轮仅在隔离测试配置打开standalone_web_search，并声明当前custom提供方的supports_standalone_web_search以探测能力；没有把这些实验性配置写到全局。只开功能开关并不证明提供方返回结构化列表。

核对了本机用 `codex app-server generate-json-schema --experimental` 生成的ThreadStartParams、RawResponseItemCompletedNotification、WebSearchThreadItem，以及OpenAI仓库主分支源码：

- `https://github.com/openai/codex/blob/main/codex-rs/protocol/src/models.rs`
- `https://github.com/openai/codex/blob/main/codex-rs/ext/web-search/src/extension.rs`
- `https://github.com/openai/codex/blob/main/codex-rs/ext/web-search/src/output.rs`
- `https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/web_search.rs`

在线源码不是本机版本的替代证明；实际生效与返回内容以本机实验为准。

## 验收语义，不能混用

`structuredResultCount=null`是未暴露；`0`仅表示实际返回空数组。`listedSourceCount`只数已知正文格式中明确的Source URL；不猜上游总量，不把正文任意超链接算成搜索结果。参考ID和来源URL也分开计量。

直接工具输出与外层封装分开记录。内层搜索与外层exec/wait的时间重叠只用于定位相关工件，不证明复杂并行场景的精确所有权；共享封装的来源不会复制成某一内层查询的结果数。

`recorderTruncated=false`只说本记录器没有裁剪；`upstreamTruncated`没有明确标志时为unknown。“有省略”单列为upstreamContentOmitted，不硬断言是长度截断。`modelConsumedAll`始终unknown，因为没有模型使用情况回执。

`complete`要求每个搜索调用均有结构化结果与直接工具输出。真实输出文件已捕获，不等于这个更强条件成立；程序严格模式仍会失败。程序不会通过放宽标准将已有失败改成通过。

## 可复用测试

```powershell
node scripts/test-web-search-evidence.mjs
node scripts/test-codex-latency.mjs

# 严格实测：缺结果/正文证据时非零退出，不冒报通过。
$env:CODEX_TEST_REQUIRE_WEB_EVIDENCE = '1'
node scripts/test-codex-hook-runtime.mjs --cwd <隔离只读目录> --prompt '请搜索 MDN Promise.all 的失败处理说明，给一条结论和来源。'
```

此实时测试会使用用户现有Codex提供方并产生调用费用。只有在临时线程配置声明独立搜索能力时，才会测到上面的独立搜索通路；普通默认通路的可见性可能不同。不自动更换提供方或启用新的付费服务。

机械测试覆盖：null与空列表、超长正文完整落盘、路径穿越式call ID、未知字段保留、缺失/明确省略状态、两种原始工具协议、exec封装、共享来源不冒认逐项所有权、加密推理不落新增日志。先建立缺失模块的失败案例，再实现并验证通过；已接入现有Windows CI。以上是记录器验收，不伪装成真实服务端完整输入已经验收。

记录器测试、计时测试、文档/工作流/安全检查通过，完整15项PR门禁也已通过。它们与上述真实搜索严格验收失败是两组不同结论，不得混为“全部通过”。

## 任务树实际落盘回执

只改ROOT节点下列字段，未改GraphState或执行流；内容来自写入工具返回的changes。

ROOT / CurrentResult

旧值：

> 本机77条方法论与9份Prompt、22个Skill无漂移，四个进程代码和图版本一致。已部署跨进程描述向量缓存与分层计时，真实质量10例及15项门禁通过；相关查询单样本约837毫秒，重复约2毫秒，首次仍约1.7秒。自然任务复测约106秒，搜索5.8秒、约86秒在工具外；整体毫秒级和稳定提速未达标，过宽Skill误触发尚待对照，跨机长期未验证。

→ 新值：

> 本机既有77条方法论与检索缓存保持；新增搜索记录器已捕获真实exec返回：1条查询、3个MDN语言版本来源、5226字符及哈希，完整本地落盘；内容是摘录且上游明确提示省略。正反例验证空值不冒充零条、长正文不二次截断和封装关联；严格全链路门禁仍失败，结构化列表与服务端实际输入回执未暴露，不能证明全部网页全文进入模型或被使用。

ROOT / RootCauseAnalysis

旧值：

> 先前把任务总耗时混作搜索耗时，分层后发现主要等待处于工具之外，不能归因于并发上限。已修每个进程重复编码静态描述及磁盘更新不等于内存更新的问题；全库预计算超时已撤回，普通文档查证额外加载开放式发现Skill是新假设，尚未证明其解释全部等待。

→ 新值：

> 旧记录只看内层webSearch事件，默认托管搜索不填结构化results，代码模式又将正文放在外层exec/wait输出，因而误判为完全不可记录。现按真实原始事件保存外层返回并单列来源及省略信息；跨多个内层调用的封装只作时间关联，不把它当成逐网页输入回执。
