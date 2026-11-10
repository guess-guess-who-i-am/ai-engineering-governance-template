# Mac 与 194 部署验收

本次只部署 Claude 机制融合的两个全局按需 Skill 及其路由增量，保留原有全局体系、三轮 Hook 和用户工作区改动。未复制 Claude 私有提示词，也未安装 Windows 安装器。

本机较新的资源模块版全局Hook与本分支安装源并非逐文件相同；本次采用精确增量，没有用旧安装器覆盖现有系统。这份记录证明所列消费者与路由可用，不证明两台机器所有配置字节相同。

## Mac 实测

- 并行 IDE 的实际 Node 运行全局配置、Skill、MCP、Hook 和并行状态定向测试，28/28 通过。误用 App 内置 Node 时 Canvas 原生模块受到 Team ID 签名限制；换回 IDE 实际使用的 Node 后同一项测试通过，无需修改产品或安装依赖。
- 两个临时工作区通过实际 `createAgentRuntime` 完整读取两个全局 Skill，正文分别为 3,029/2,851 字节；实际 UserPromptSubmit Hook 为 128/125ms，未阻断且无路由错误。此前冷重载样本达到 33.4 秒，不能声称所有请求始终低延迟。
- 常驻图的重复查询突发/错峰各 100/100 成功。另以不同完整查询文本测试未命中整条结果缓存的 100 请求，实测峰值重叠100、100/100成功、p95 4.18秒、最慢4.53秒。测试语义围绕8类工程任务，非生产流量分布。
- `scripts/check.ps1` 的15项PR门禁通过。模型健康接口返回成功，但这不是模型实际任务质量或token节省的对照实验。

## 194 的部署边界与故障定位

目标是 Linux `hyf@192.168.4.194:22222`，不是另一台 Mac。它已有用户修改的仓库，未执行 pull、reset 或覆盖该工作区。

备份目录：`/home/hyf/.codex/backups/desktop-skills-20261101-155329`。两个新 Skill 安装到 `/home/hyf/.agents/skills`，正文哈希与Mac相同。只向原路由规则合并这两个 Skill 的别名和精确触发条件。

首次刷新失败的根因是全局刷新器导入了未部署的 `mcp-catalog.mjs`。补齐Mac已用模块后，刷新进入实际构图。服务器图清单此前带有Mac路径，外部库配置却是Linux路径，必须在服务器本机重建，不能直接复制Mac图冒充可迁移部署。

26项路由正反例先揭示了两处缺失：候选装配没有“元数据只是数据”的提醒，以及新工作流缺少否定/解释过滤。补入候选读取说明，并对注册表与图返回候选一致执行动作门禁后，26/26通过。预先运行的真实IDE消费者测试仍因旧图未收录新Skill而失败，不能把文件复制成功等同于验收。

服务器候选Worker还通过16项Worker、9项资源图和4项关键词等价测试；这是候选源码证据，不等于已经替换线上Worker。

## 194 最终验收

- 全量双语图在服务器本机重建用时41分15.664秒，最终15,496个Skill（15,472外部＋24自有）、21个该机实际发现的MCP工具、4,232个资源模块；缺失/无效均为0。图、外层清单与注册表的本机路径/计数一致，两个新Skill经图查询均能召回。MCP数量按本机实际服务发现，不复制Mac的27作为服务器能力。
- `codex-graph-worker.service` 受控重启成功，4个查询进程、中英文通道和预过滤全部就绪；最终active/running、enabled，用户linger已开启。这里只重启检索服务，未重启整机或其他IDE服务。
- 发现18个运行路径、5个入口源码版本。起初按入口哈希抽样遗漏了同源码不同依赖安装的情况，后改为18路径全部测试，每路径两个临时工作区，共36个消费者；最终18/18通过，实际Hook为407—508ms。它证明从这些路径新建的执行runtime可消费全局配置，未验证所有已打开界面的内存状态或完整模型任务。
- 全局kit此前缺`managed-project-hooks.js`等5个源码模块，以及`@vscode/ripgrep@1.18.0`、`cheerio@1.0.0`、`smol-toml@1.9.1`、`@modelcontextprotocol/sdk@1.32.1`。补齐匹配入口源码的缺失模块，保留已有不同模块。npm联网安装ETIMEDOUT后，使用npm自带Arborist从已安装完整runtime解析118个依赖节点，逐包核对版本与内容后离线部署，并同步manifest/lock。复制首次因父包已带入嵌套依赖而中止，核对已有内容一致后补齐；没有覆盖原有不同包。最终Arborist实际树和锁文件树的4个根依赖均有效，真实ripgrep二进制可执行。
- 真实全局图路由6项正反例通过，新增两个Skill在否定/解释句中均不被选中；其他候选只是推荐数据，未执行任何候选工具。
- 突发、错峰、100个不同文本请求均100/100成功，无重试。缓存突发/错峰p95为39.6/16.0ms；不同查询峰值重叠100，p95为20.56秒、最慢22.24秒。这是8类工程语义的受控负载，尚不能称为100个任意复杂查询的延迟保证。

最终保留部署，无需回退。服务器既有Worker源码未替换；本轮压力结果不能据此宣称获得Mac新版Worker的速度优化。全部变更的哈希和回退材料保存在上述备份目录，消费者、压力和路由JSON副本保存于本机`.reports/deployment-194-20261101/`。Mac最后一次带新增Skill图召回断言的不同查询p95为3.15秒、最慢3.41秒，机器间速度存在差距。

## 可复跑检查

使用各IDE实际使用的Node，执行：

```sh
node scripts/test-desktop-global-integration.mjs \
  --ide-runtime /actual/ide/server/agent-runtime.js \
  --output /tmp/global-consumer.json
python3 scripts/verify-global-graph-deployment.py --distinct \
  --output /tmp/global-graph-load.json
```

消费者检查会读取实际全局Skill并执行真实Hook；不调用模型、不读取认证。压力检查通过本用户的Unix socket访问已有常驻Worker，记录每个请求的起止时间、PID、成功与延迟。`--distinct`增加100个不同查询；该检查会产生检索负载，不修改配置。

刷新必须使用服务器现有的共享锁入口；不要同时手动运行构图与后台刷新：

```sh
~/.codex/tools/graph-tool-call-venv/bin/python \
  ~/.codex/hooks/graph_skill_index.py refresh \
  --lock ~/.codex/skill-registry/refresh.lock \
  --node ~/.local/bin/node \
  --script ~/.codex/hooks/refresh-skill-registry.mjs --wait-timeout 900
```

## 回退原则

若新增内容导致真实消费者或原有回归失败，先停止本轮刷新并确认子进程退出，再根据备份恢复本次改动的规则、router、注册表和图；仅删除本轮新增且内容未被其他任务改动的两个Skill。原图备份使用硬链接，构图以原子替换发布，避免拷贝额外占用磁盘。不要回退服务器其他任务或覆盖认证配置。新增MCP发现模块修补的是原有缺文件故障，不应仅因回退Skill而让刷新器再次失效。

未实测的IDE界面、其他客户端、整机重启及真实模型任务质量，均不在“已通过”的范围。
