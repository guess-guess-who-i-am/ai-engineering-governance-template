# 短追问的全局检索修复

2026-11-08。本次修复的是“效果怎么样？”等追问在进入全局图前丢失任务语义的问题，不是全库推荐准确率已经解决。

## 根因与修复位置

1. 原查询解析只识别少量继续措辞。“现在是推荐变得更好了吗？”没有读取历史，直接检索抽象短句；原适配器也不读助手最终方案。
2. IDE 的 `deepseek-run.js` 在 `UserPromptSubmit` 之后才加载显式、恢复或分叉历史。即使解析器支持历史，入口也没有传递。
3. 图收到补全任务后，精确能力路由仍检查原短句。PDF案例因此仍不如直接输入完整任务。

全局 `routing-context.mjs` 负责有界语境选择；`skill-router.mjs` 的图检索、词法评分和能力判断使用同一解析查询。明确点名Skill的优先级只检查本轮原文，历史与图边不构成调用授权。模型对话正文保持不变。

IDE在Hook之前加载原有历史，传递 `routing-context/1`；部署补丁位于 `scripts/patch-ide-routing-context.py`，不包含整份第三方执行器。补丁校验唯一源码锚点，依赖先原子发布，再发布执行器；重复执行会同步更新解析依赖，失败恢复备份。

## 查询如何形成

- 自包含请求直接检索；指代或省略请求回溯到最近自包含用户任务，保留近期用户修正；“第二个方案”等同时读取相关助手最终答复。
- 明确换话题切断旧任务；纯状态词不与任务一同向量化，避免“better now”挤掉真实能力词。具体测试、部署等操作和当前限制继续保留。
- 中文词法按最长词优先匹配，避免“改”先消耗“改进”；明确任务对象中的“这个第三方MCP插件”不视作缺失任务。
- IDE传输同时校验会话和工作区。Codex读取传入的transcript，校验可用的会话metadata，只识别已验证的message格式，排除工具、commentary、环境指令、明显凭据和当前轮之后记录。
- 不使用跨会话可变记忆，不保存用户prompt，不扫描其他聊天；无可恢复任务时返回空推荐。

边界是工程预算，不是论文证明的最优阈值：transcript最多读尾部8MiB和头部16KiB；历史正文最多3200字符，锚点1600、单次用户修正800、助手答复1200。头尾保留不能保证超长任务的全部限定词；锚点已被尾部预算淘汰时明确放弃解析。语言规则是保守解析器，不能覆盖任意自然语言指代。官方说明transcript格式不是稳定接口，未来宿主格式变化需要新契约测试。

## 实验与限制

证据汇总见 [JSON](evidence/conversational-routing-20261108.json)。

| 检查 | 结果 | 能说明什么 |
|---|---|---|
| 原14任务的中英文短追问，共28例 | 目标命中0/28 → 23/28 | 恢复了上下文带来的任务信息 |
| 同28例完整任务 | 修复前后均23/28，无退化 | 修复没有提高既有完整查询的召回上限 |
| 上下文单元回归 | 45项通过 | 覆盖助手方案、换话题、会话隔离、1000轮继续、有界淘汰和用户修正 |
| 真实IDE执行器+真实全局Hook | Mac、194各3种入口通过 | 显式历史、恢复、分叉均在Hook前带入任务；模型HTTP响应受控 |
| 两机真实全局路由 | 各100次、峰值8路重叠，零重试/超时 | 追问100/100与各自完整输入的候选列表一致 |
| 安装、已有关系与桌面路由 | 完整安装通过，21+12+26项回归及15项PR门禁通过 | 依赖安装与已覆盖行为没有退化 |

100次请求混合4个任务、两种历史传输并错峰到达。最终复验Mac P95约168ms，194约135ms，均为已驻留、重复任务且可命中缓存的样本，不是冷启动、100路同时执行或任意长任务延迟保证。其预标目标仅75/100命中：Excel完整任务本身不命中目标，追问如实继承该缺口。28例中剩余5例同样是完整任务推荐问题。不能把“恢复完整查询”当作业务成功率或通用82%准确率。

早期错误和负结果保留在机器的context-routing缓存证据目录：旧版解析/IDE红灯；较宽指代规则导致安装器供应链用例失败；新增复合动作测试漏掉连词；修复后均重新通过。首次Excel压测失败推动拆分“上下文恢复”和“目标相关性”两个指标，没有更改原相关性标签。

## 研究如何影响实现

- [QuReTeC，SIGIR 2020](https://arxiv.org/abs/2005.11723)，DOI `10.1145/3397271.3401130`：从历史选择查询所需信息，而不是盲拼全历史。借鉴其信息选择思路；本实现没有复现其训练模型。
- [CONQRR，EMNLP 2022](https://aclanthology.org/2022.emnlp-main.679/)，DOI `10.18653/v1/2022.emnlp-main.679`：重写应以真实检索效果验证，而不只看文本是否通顺。
- [Multi-Query Generation，SIGIR 2024](https://arxiv.org/abs/2406.18960)，DOI `10.1145/3626772.3657933`：单一改写可能误判意图。本次未把多query生成放入默认Hook，避免混淆本轮修复变量与耗时。
- [Apple QReCC](https://github.com/apple-aiml-research/ml-qrecc)：历史包括用户与助手，分别考察查询、检索和答案质量；本轮不宣称完成QReCC评测。
- [LangChain历史感知检索源码，v0.2](https://github.com/langchain-ai/langchain/blob/v0.2/libs/langchain/langchain/chains/history_aware_retriever.py)：有历史再解析，无历史直接查。部分master/其他tag源码404，最终读取此版本；不能把失败URL当已读证据。
- [Stack Overflow讨论](https://stackoverflow.com/questions/76561073)：仅作历史传递的工程线索，回答票数低，不作为研究结论依据。
- [Codex Hooks文档](https://developers.openai.com/codex/hooks/)：transcript_path可为空、格式不稳定；因此明确区分宿主传输与已验证transcript适配。

在线模型改写另做4例pilot，耗时33.19–39.25秒，且一例使用历史却返回错误的needs_context标记；没有放入默认每轮Hook。这不是模型改写的质量上限，只说明该次接入不满足轻量同步路由的延迟要求。没有找到足以决定本轮实现的额外SCI证据，不补写论文权威。

## 安装、验证与回退

Mac原安装器及持久右键部署源均包含新模块；普通工作区不复制Skill或Hook。194安装在用户级全局目录。现有全局图无需重建或重启。Mac已通过原空闲检查更新13个可达项目服务。194后续经全量盘点，把94个有效入口保留原端口统一到完整运行时，55个项目根目录已消失的历史服务未重建；详见[完整部署验收](COMPLETE_194_DEPLOYMENT_20261108.zh.md)。

将本仓库安装到其他电脑后，IDE若另有独立运行时，对实际使用的执行器应用补丁：

```sh
python3 scripts/patch-ide-routing-context.py --runner /actual/kit/server/deepseek-run.js --check
python3 scripts/patch-ide-routing-context.py --runner /actual/kit/server/deepseek-run.js
```

重启必须通过宿主原有空闲检查及升级入口；文件已更新不等于旧进程已经重新导入。不要杀正在运行的业务任务。新副本或SSH新发行包仍需包含相同补丁。

离线回归：

```sh
node --test scripts/test-routing-context.mjs
node scripts/test-desktop-skill-routing.mjs
python3 scripts/test-patch-ide-routing-context.py
```

全局安装后，可显式运行真实消费测试；不会重建图，IDE测试使用隔离项目和受控模型HTTP响应：

```sh
node scripts/test-live-context-routing.mjs --output /absolute/evidence.json
node scripts/test-ide-routing-context.mjs --live-hooks --runner /actual/kit/server/deepseek-run.js --report /absolute/ide-evidence.json
```

每次部署收据记录全局Hook和执行器的独立备份。回退时先确认服务空闲，恢复对应执行器、解析依赖和全局router，随后按原入口重新启动并复验；不能只删依赖留下import。图、Skills、模型配置和认证不属于本次回退范围。
