# IDE 全局路由接入核对（2026-10-18）

本报告记录15:41–15:44的旧broker观测；IDE后续v12修复的独立验证见[兼容性复核](IDE_GLOBAL_COMPATIBILITY_V12_20261018.zh.md)。不要把旧661的读取失败当作新版实测结果，也不要认为旧任务已自动切换。

## 结论与边界

全局 Hook、GraphToolCall 和常驻进程确实被生产 IDE 使用；没有发现需要重新部署全局 worker 才能解决的版本漂移。当前长任务单轮约28秒，不应归因于历史56秒 Hook 数据。但“图能推荐”不等于“IDE 能读取并使用全部 Skill”：已在生产共享 runtime 中复现外部 Skill 被 `skills_read` 拒绝。

仅通过 GET 获取生产任务状态。探针另建临时目录和独立 session，连接已运行的共享服务；没有调用生产任务的 Hook、SessionStart 或 Stop，没有模型请求，没有修改 IDE/Kit 源码、重启生产进程或重新构建索引。为不干扰长任务，只测4路检索和2路 runtime，不在此时重跑100路压测。

原始脱敏报告：`.reports/ide-global-routing-20261018.json`；15:44复测为 `.reports/ide-global-routing-20261018-repeat.json`。可复用核对脚本：`scripts/audit-global-ide-routing.mjs`。报告不保存用户提示、模型内容、Hook上下文或密钥，只保存时间、版本、路径及状态；在本机保留，不进 Git。

## 进程与部署版本

- 生产服务：127.0.0.1:5505，PID 1074，实际入口为 IDE 安装目录的 `llm-task-tree-kit/server.js`。
- 公共 runtime：PID 661，入口 `server/shared-agent-worker.js`，socket 末段为 `task-tree-agent-501/12b20698d17a1c030d01.sock`；生产任务的 `runtime/ready` 回执也确认 PID 661。
- 全局图入口：PID 687，`~/.codex/hooks/graph_skill_index.py`；检索子进程为692、695、696、697。socket 为 `/tmp/codex-graph-501/2fd902670b31d39480d6c69a.sock`。
- worker SHA-256：`d68f60ea0d785702389741dc4ab1c32c2a934ecd7612745606e21ffa7a461d6a`，路由器 SHA-256：`6297b07ce5154bacc190ef42d9502930a8b07448c6937650d13f7b9c77714f18`。全局安装文件与本工作区对应文件逐字节一致；worker 包含此前已存在、尚未提交的关键词加速修改，不应误称其仍是9289463的原始字节。本次没有覆盖这些修改。
- GraphToolCall 0.46.0；embedding 为 all-MiniLM-L6-v2。全局图248,390,967字节，manifest时间为10月17日23:07（北京时间），15493个Skill（含22个治理Skill）、24个MCP工具、1个缺失Skill。不能宣称目录中每个Skill均已进入图。
- 轻量注册表只有35条是预期优化：外部15471个Skill由图驻留检索，不应把它们重新塞回每请求解析的JSON。

## 生产任务观测

目标任务 `56c0e71b-e3da-4a81-9f87-7e192ea31e51`，15:41:37快照仍为running：

- 已177轮、217个完成工具事件；runtime初始化103毫秒。
- 初始UserPromptSubmit：全局 `~/.codex/hooks.json` 成功412毫秒、无警告；项目Hook成功81毫秒、有警告。后者属于IDE侧隔离目录问题，由另一对话处理。
- 工具Pre/Post Hook累计589+308=897毫秒。
- 最近5轮模型请求阶段24.18–28.02秒，整轮26.76–32.78秒；请求体约5.38MB。这是模型/输入链路观测，不是全局检索耗时，也不能只凭字节数判断所有内容均可删除。
- 源码调用边界：`deepseek-run.js` 在新用户请求入口执行UserPromptSubmit，把结果放入模型system上下文；内部每个模型轮次不重复执行UserPromptSubmit。三轮提醒按用户提示事件计数，不是每三个模型工具轮次。

## 实际共享、并发与缓存

短查询样本，不能代替10月11日的长输入100路实验：

| 探针 | 结果 |
|---|---|
| 图第一次检索 | 成功，600毫秒，queryPid 697，loads=1、prefilter=true |
| 完全相同查询再次请求 | 成功，2毫秒，未增加加载次数 |
| 四个不同查询同时到达 | 4/4成功，墙钟650毫秒，分别由692/696/695/697处理 |
| 两个独立runtime会话 | 均复用661；打开总墙钟71毫秒，同目录只新增一个共享MCP桥 |
| 两路完整全局UserPromptSubmit | 均包含CODEX_SKILL_ROUTER_V2，110/111毫秒，总墙钟112毫秒，无警告；查询已被上面的直接探针预热，属于结果缓存路径 |

当前响应的metrics会被子进程报告覆盖，不能把响应中的cacheHits=0当作入口缓存未生效的证据；本次以相同查询2毫秒返回、加载次数与PID复用交叉判断。没有测冷启动或缓存失效，也没有重启IDE。

## 首次断点：推荐路径被IDE读取器拒绝

实际Hook推荐：`~/.codex/tools/skills/sickn33-postgresql-optimization/SKILL.md`。

在同一公共runtime中执行 `skills_read`，传入该精确绝对路径，返回 `Skill not installed: ... Use skills_list.`。两个探针runtime的skillCount均为39，不含图中的15471个外部Skill。复测时用同一runtime的 `read_file` 能完整读取4122字节，排除文件不存在/不可读；这里只核对返回字节数，不将正文引入诊断上下文。

根因边界在IDE的 `server/agent-runtime.js`：`refreshSkills()`只读轻量skills-index；`skills_read`只允许本地发现/轻量注册表中的条目。全局层移除重复外部扫描后，推荐仍正确，但IDE消费者错误地把轻量注册表当成完整授权目录。这是消费者登记/校验不匹配，不是图没有加载或服务串行。

## IDE侧需要的接入（本聊天未改IDE）

1. 让 `skills_read` 能安全解析图推荐的精确外部路径：依据全局外部库manifest/目录登记校验，realpath后必须仍在已登记根内，拒绝越界、符号链接逃逸和非SKILL.md文件；不要靠每次全库递归扫描恢复15k目录。
2. 补齐 `skills_list` 的外部目录发现能力，但延迟加载/缓存外部manifest；不要把15k条目全量塞进system提示。系统提示中“推荐路径可直接skills_read”的承诺必须有回归测试。
3. 对已运行的661，修改磁盘代码不会自动替换内存中的函数。先为新会话增加独立版本socket或等任务结束后更新；禁止为修复本问题杀掉当前661。Kit与外层源码要对齐，因为生产入口、broker加载路径不同。
4. 复测比较了图目录与真实runtime工具表：20个task_tree名称已导出，4个node_repl名称（js、js_add_node_module_dir、js_reset、turn_ended）未导出。桌面专属能力应标记为当前客户端不可用，不能因为图有条目就声称能调用；也不应伪造同名实现。本次没有执行MCP写工具来验证。
5. 当前全局路由器明示 `Assistive routing only`，IDE的skills_list仍是子串过滤，工具调用没有“已路由候选”准入记录。因此已确认UserPromptSubmit使用图，但不能宣称所有Skill/MCP调用都有机械强制路由门禁。如果“全部必须经过路由”仍是硬要求，需要在IDE调用边界和全局路由之间另补候选回执/客户端能力契约，不能仅靠提示语证明。

完成标准：同一生产版runtime中，外部候选精确路径的skills_read成功且完整返回内容；非法/越界路径仍拒绝；两Agent同时读取与检索复用共享服务；随后再验证新版本的非缓存长输入100路。全局层当前无需重启或重复部署。

## 核对脚本验证

真实运行两次成功生成脱敏报告；第二次复用同一隔离目录，没有增加新MCP桥。Node语法检查和 `git diff --check` 通过。指定不存在的runtime socket时以ENOENT明确失败并退出1，没有启动替代broker，也没有连接或重启生产IDE。这个诊断脚本成功退出只表示收集结束，不表示上面列出的产品缺口已修复。

复现时使用可执行Node绝对路径，传入 `--runtime-socket`、`--url http://127.0.0.1:5505`、`--run-id` 和 `--output`；复测可用 `--scratch` 指定已有的global-routing-audit临时目录。脚本拒绝把真实项目目录用作探针工作区。
