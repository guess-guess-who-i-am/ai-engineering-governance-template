# 194 全局检索部署与验收



### 最终收尾与未通过边界

- ROOT · CurrentResult：194全局图15515节点，8进程常驻服务已启用并通过自动恢复，正式Hook信任与共享daemon新会话MCP已验证。完整Hook100请求突发/错峰均100/100，P95为31.64/23.80秒，真实Codex只读任务测得4进程重叠。最终热态验收与收尾检查进行中，不能承诺模型/API响应同步提速。 → 194全局图15515节点，8进程常驻服务与自动恢复、Hook信任及共享daemon新会话MCP均验证，无配置漂移。完整Hook100请求突发/错峰均100/100，P95为31.64/23.80秒；真实Codex曾测得4进程重叠。最后热态Hook耗时3.43秒，但整轮180秒未完成，部署可用，整体对话提速仍未证实。
- ROOT · NextIdea：完成热态Codex验收，记录可复用安装说明及最终配置漂移检查结果。 → 隔离模型等待、上下文读取和工具执行耗时，定位真实Codex热态任务180秒未完成的首个慢边界；不再重复迁移worker。

日期：2026-10-18。对象：192.168.4.194 的 hyf 用户；不是项目局部安装，也没有覆盖 Linux 分支或复制 Mac 认证。

本页记录上一阶段的worker迁移和当时“保留服务器提示词”的决策。用户随后要求统一提示词；最新规则、不中断服务的更新及真实对话前后对照见 [提示词统一验收](SERVER_194_PROMPT_UNIFICATION.md)，不要把下述历史提示词保留策略当成当前状态。

## 运行边界

- 全局目录：`~/.codex/tools/skills`、`~/.agents/skills`、`~/.codex/skill-registry`。
- 15,472 个外部 Skill、22 个治理 Skill，task-tree MCP 实际枚举 21 个工具。图由目标机重新生成，不复用 Mac 绝对路径。
- CPU-only Torch 2.6.0+cpu、GraphToolCall 0.46.0、sentence-transformers 6.1.0；本地 MiniLM 模型已离线编码验证，向量维度384。
- 检索池先配置8进程、128在途连接、256等待队列；Agent会话上限20与检索请求并发是不同维度。线程数1避免底层数学库过度竞争。
- 用户服务 `codex-graph-worker.service`：自动预热、失败重启、开机启动；hyf 的 Linger 已启用。CPUQuota800%，MemoryHigh16G、MemoryMax24G是保护上限，不是实际内存占用。
- 保留194自己的提示词和现有同名治理Skill；只补缺少的Skill。不改变模型、推理强度、API来源、认证或其他任务。

## 本次定位的迁移缺陷

1. Mac默认大小写不敏感，Linux敏感：129个Skill的原始文件名是小写 `skill.md`。索引器现返回真实文件名，并继续拒绝越界与外部符号链接；没有复制两份Skill来掩盖问题。
2. 原始目录中有1个空Skill目录。已从原始仓库固定提交恢复：
   - 来源：mukul975/Anthropic-Cybersecurity-Skills
   - 提交：a0372fc6aa37066b7e1a6b12cea6e78a8be78779
   - 文件：skills/detecting-fileless-malware-techniques/SKILL.md
   - SHA256：eb069039f9f19fdad27d0d427ded461006e1a01ab5055d62b6ed97bd8b20ed0e
   - 仅存储和索引，没有执行其中的安全检测步骤。
3. task-tree旧预设指向Windows的E盘。现在通过正式 `codex mcp add` 注册目标机全局运行时，以Node22启动、从调用方cwd识别工作区。
4. dispatcher内部路由由12秒提高到60秒，外层UserPromptSubmit为65秒；固定提醒三轮一次，动态路由每轮执行，保留服务器自有提示词。Linux路由器统一通过systemd唤起已安装服务，避免故障时抢跑一个游离的默认4进程池。
5. 两个Hook通过Codex 0.160.1正式审阅界面逐个信任；之后独立运行端 `hooks/list` 均返回enabled且trusted。没有手改trusted_hash或使用信任绕过参数。

## 可复用安装步骤

这些命令是维护说明，本次已由Agent执行；用户不需要手工运行。

先准备用户私有备份、Node22、Python3.12虚拟环境、离线MiniLM缓存和全量Skill库。不要复制另一台机器的config.toml、凭据、整个node_modules或Mac虚拟环境。CPU Torch从PyTorch CPU索引安装，避免拉入CUDA依赖。

```sh
python3 -m venv "$HOME/.codex/tools/graph-tool-call-venv"
"$HOME/.codex/tools/graph-tool-call-venv/bin/python" -m pip install torch==2.6.0+cpu --index-url https://download.pytorch.org/whl/cpu
"$HOME/.codex/tools/graph-tool-call-venv/bin/python" -m pip install 'graph-tool-call[embedding]==0.46.0' sentence-transformers==6.1.0
node scripts/install-global-graph-linux.mjs --apply --processes 8
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=1 \
  "$HOME/.codex/tools/graph-tool-call-venv/bin/python" "$HOME/.codex/hooks/graph_skill_index.py" refresh \
  --lock "$HOME/.codex/skill-registry/refresh.lock" --node "$(command -v node)" --script "$HOME/.codex/hooks/refresh-skill-registry.mjs"
systemctl --user daemon-reload
systemctl --user enable --now codex-graph-worker.service
```

运行安装器前必须已有dispatcher、context-refresh、hooks.json与routing-rules.json；此入口是现有Linux配置的窄迁移，不是空白机器完整安装器。默认不带 `--apply` 只检查。备份位于 `~/.codex/backups/global-graph-<时间>/`。Linux安装器显式配置 `requireComplete=true`，刷新时使用 `build --require-complete`；完整性失败不替换上一份好图，缓存命中也要求缺失/无效数为0。未启用严格模式的既有Mac仍保留报告缺项的旧契约，不因原库缺项而禁止其所有刷新；必须检查图manifest，不能只看refresh进程退出0。

task-tree运行时放在 `~/.codex/tools/llm-task-tree-kit`。直接注册其 `scripts/mcp-server.mjs`，不要用仍含Windows路径的项目stub。新机器须通过正式Codex界面审阅并信任本机Hook；不跨机器复制信任记录。

服务管理：`systemctl --user status codex-graph-worker`；日志：`journalctl --user -u codex-graph-worker`。安装器重复检查应无差异。服务停用/回滚只针对本次创建的服务和对应私有备份；不要重启共享Codex daemon或整台服务器。

## 验收记录

已通过：Mac和194各15项真实worker回归；Linux迁移测试的只读检查、配置保留、三轮节奏、超时、进程数边界、MCP预设迁移、严格完整性配置和幂等；Python依赖一致性与离线embedding编码；最终源码版本的Mac完整一键部署测试；完整目录缺失数0；MCP工具枚举21。后台刷新离线模式、1–20线程范围、旧非严格建图兼容及严格建图拒绝残缺图均有回归覆盖。

目标机全量图：15,515工具节点，其中15,494个Skill节点、21个MCP节点；所有Skill路径存在，非全局路径0，Mac路径0。注册表28条只保留小型元数据入口，不是全库只有28个Skill。

在8进程服务已预热后，对独立长查询运行；每轮使用不同seed避免结果缓存掩盖排队。错峰按第1秒10个、第2秒5个、第3秒20个、第4秒25个、第5秒40个到达。

| 场景 | 成功 | P50 | P95 | 最大 | 证据文件（194仓库下） |
| --- | --- | --- | --- | --- | --- |
| 完整Hook，100请求突发 | 100/100 | 19.13s | 31.64s | 35.67s | .reports/194-eight-burst.json |
| 完整Hook，100请求错峰 | 100/100 | 12.83s | 23.80s | 26.57s | .reports/194-eight-stagger.json |
| 故障恢复后socket，100请求错峰 | 100/100 | 17.24s | 27.07s | 31.60s | .reports/194-recovered-socket.json |

后者由同一个监督进程2315725处理，8个实际查询PID均出现，每个进程loads始终为1；因此不是100次独立加载图。进程RSS合计8909.9MiB（含共享页重复计数），systemd实际cgroup内存约7.3–7.9GiB，启动峰值约15.5GiB。使用8个单线程CPU检索进程，在共享机器上留出内存与CPU余量，不盲目建立100份模型/图。

自动恢复：只向本次部署服务的主进程2279098发送SIGKILL。systemd自动重启为2315725，NRestarts=1，预热记录8请求/8查询进程/prefilter=true，再次100/100成功。enabled与Linger=yes均核验；没有实际重启整机，不能称已做物理重启验收。

真实Codex验收：以原有gpt-6.1-sol/high、正式信任、只读沙箱启动临时会话，不创建子Agent。SessionStart完成443ms；恰逢恢复时UserPromptSubmit完成36696ms且实际包含路由，无错误。实际终端输出4个不同PID、约200ms的计算区间，实测峰值重叠4；整个临时对话121.144s，不能把全部时间归因于CPU或Skill检索。CPU证据校验器接受这4条实测区间，并拒绝只有模型自述、非零退出和串行区间。

后续热态复测没有全部通过：一轮Hook完成2245ms，但校验器错误地要求不同隔离执行中的PID也全局唯一；已改为真实commandExecution ID与PID共同标识，仍必须四条有效区间且实测重叠4，并加入同PID、不同执行空间的回归。不能把这次测试假设错误当作生产并发故障。最后一轮正式运行端再次确认两个Hook均trusted、20路Agent配置有效；SessionStart完成425ms，UserPromptSubmit完成3431ms，routed=true且无错误，但整轮在180秒时仍未完成，被测试客户端终止。该轮无成功JSON报告，不能冒称热态端到端通过，也没有足够阶段事件把剩余时间全部归因于模型/API或工具。此前成功的真实4路执行与100请求压测仍有效；整体对话提速尚未证实。

最终只读检查：安装器返回changes=[]且并发配置current；服务active/running、enabled，Linger=yes；8个查询进程已预热，prefilter=true。当前服务主进程2398403，cgroup内存8039030784字节（约7.49GiB）、启动峰值16101228544字节（约15.00GiB）；共享Codex仍为原PID1220249。本次没有修改模型、重启共享daemon或中断用户原有对话。

无需重启共享Codex：通过0.160.1 CLI的正式 `--remote unix://...` 接入既有daemon，`/hooks`显示SessionStart和UserPromptSubmit都是Installed=1、Active=1；`/mcp`显示task_tree connected (21 tools)。原daemon PID1220249、启动时间10:38:56均保留。此前手写proxy/JSONL检查失败不能说明daemon不可用；正式远程客户端验证成功。此证据覆盖新接入会话，不把它夸大为所有已运行旧会话的静态工具集都被重建；本次未中断这些会话。

固定提醒实测1/4/7轮注入；相同turn_id幂等，compact后重新注入。动态路由通过完整Hook及真实Codex事件验证。首次全库embedding建图约12分钟，仅一次；后台更新现限制最多8线程且强制使用本地离线模型，避免每次会话启动联网探测或抢满全部CPU。更新外部库时同步更新其目录索引；更新治理Skill或MCP后，SessionStart后台摘要检查会重建变化的图，并原子替换；查询进程按图版本失效缓存。

限制：没有更换模型、降低推理强度或调整上下文压缩阈值；模型/API耗时仍可能主导长对话，不能保证所有回答都加速。远程HTTP MCP目录发现仍不在本次实现内。PowerShell完整仓库门禁未运行，本机无pwsh，Skill所列scripts/verify-repository.ps1也不存在；不冒称全仓门禁通过。

## 任务树变更回执

仅使用task_tree_write持久化changes；未改GraphState或执行流程。

### 开始迁移

- ROOT · Completion：已完成 → 进行中。
- ROOT · CurrentResult：macOS全局4进程检索通过100请求复核，P95约25–41秒，见docs/GRAPH_WORKER_VALIDATION.md。194运行端已读到20上限与多Agent开启，两个会关闭并发的生成脚本已修复，回归通过且4进程真实重叠。两个全局Hook仍须用户重新信任，全量图与常驻worker尚缺，不能宣称194真实任务已提速。 → macOS全局4进程检索已通过100请求复核。194已开启20路多Agent，但尚缺全量图、常驻worker与有效Hook信任，当前正在迁移，不能声称对话已经提速。194有约45GB可用内存且用户服务支持开机启动，部署保留原提示词和现有任务。
- ROOT · NextIdea：用户在194连接中重新信任两个全局Hook后，用新任务核验注入、实际工具重叠与响应耗时，再推进全量图迁移。 → 完成194全局CPU检索池与自动恢复部署，压测100请求，再核验Hook信任和真实会话生效范围。

### 目录与信任修复

- ROOT · Notes：只支持 macOS；20 是硬上限，不是首波目标。全局 Skill/MCP 经过 GraphToolCall。另一台 Mac 的重启恢复尚未实测，远程 HTTP MCP 目录发现尚未接入。 → 194复用全局检索实现，保留服务器提示词、模型和现有任务；20仅为Agent硬上限，检索池独立调节。未实际重启服务器，远程HTTP MCP目录发现仍未覆盖。
- ROOT · CurrentResult：macOS全局4进程检索已通过100请求复核。194已开启20路多Agent，但尚缺全量图、常驻worker与有效Hook信任，当前正在迁移，不能声称对话已经提速。194有约45GB可用内存且用户服务支持开机启动，部署保留原提示词和现有任务。 → macOS原有100请求复核证据保留。194已开启20路多Agent，并经Codex正式界面信任两个全局Hook；15472个外部Skill、22个治理Skill及21个MCP工具已补齐，统一图正在首次生成，常驻池与真实对话速度尚待验证。
- ROOT · RootCauseAnalysis：194使用另一分支的旧配置，Linux修复与懒加载脚本会关闭多Agent并抹去并发设置，Hook修改后又与信任记录失配。旧Hook手测约0.4秒且部分任务已有批量执行，长上下文与模型响应耗时不能归因于图检索串行。 → 194旧分支没有全量worker，生成器会关闭并发，Hook修改后失去信任；task-tree MCP还指向Windows路径。Linux另暴露129个小写skill.md与1个源库空目录，现已兼容原文件名并按固定上游提交补齐缺失文件。
- ROOT · NextIdea：完成194全局CPU检索池与自动恢复部署，压测100请求，再核验Hook信任和真实会话生效范围。 → 等待194统一图建成后预热8进程池，运行100请求突发、错峰、故障恢复及真实Codex只读验收。


### 全量压测与运行端验证

- ROOT · CurrentResult：macOS原有100请求复核证据保留。194已开启20路多Agent，并经Codex正式界面信任两个全局Hook；15472个外部Skill、22个治理Skill及21个MCP工具已补齐，统一图正在首次生成，常驻池与真实对话速度尚待验证。 → 194全局图15515节点，8进程常驻服务已启用并通过自动恢复，正式Hook信任与共享daemon新会话MCP已验证。完整Hook100请求突发/错峰均100/100，P95为31.64/23.80秒，真实Codex只读任务测得4进程重叠。最终热态验收与收尾检查进行中，不能承诺模型/API响应同步提速。
- ROOT · NextIdea：等待194统一图建成后预热8进程池，运行100请求突发、错峰、故障恢复及真实Codex只读验收。 → 完成热态Codex验收，记录可复用安装说明及最终配置漂移检查结果。

