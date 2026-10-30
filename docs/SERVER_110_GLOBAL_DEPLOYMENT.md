# 110 用户级 Codex 全局部署验收

验收日期：2026-10-18。目标：192.168.4.110（SSH 别名 fqd），用户 fqd，用户目录 /data/fqd。

## 当前结论

本次已修复 110 到 API 的直连超时路径，并让桌面远程进程和共享后台继承 110 自有代理。正式共享后台聊天已完整结束；真实模型执行八批次工具，8/8 正确且实测峰值并发为 8。补齐 uv/uvx、全局并行入口和实时搜索；原 20 进程检索池保持运行。已配置开机自启并实测代理故障自动恢复，但没有重启整台共享服务器，不能保证线路永久不波动。三平台检查与 Git 发布继续暂停。

## 最新验收：waiting for network 根因与修复

### 失败信号与分层定位

用户指定的聊天 01a14dc2-b867-71e2-ac13-c65a42502b3a 位于 fqd。最新故障轮次等待 507,475 毫秒后中断，持久化内容只有用户消息，没有模型工具执行。

同一 API 的无认证 models 探针无需经过 Skill、Hook 或模型推理：110 可建立 TCP，但随后间歇出现 TLS 握手超时或收不到 HTTP 首字节。两组 Cloudflare 地址都出现过失败，修改 HTTP 版本或 TLS 协商条件也未稳定解决。Mac 直连同样有失败，而经其系统代理的对照三次全部在 0.44–0.82 秒返回 401。这里 401 是无认证探针抵达 API 的正常证据，不是网络故障。

110 的真实八批次基线在 90 秒期限内没有开始工具执行；SessionStart 104 毫秒，UserPromptSubmit 1,536 毫秒，之后一直等模型。旧桌面进程和共享后台均未设置 HTTP/HTTPS 代理。这些结果将主要故障定位到模型请求的网络路径，不支持把本次长等待归因于检索池串行或每次重载图；尚未定位远端运营商、边缘节点或供应商内部的具体责任。

### 用户级代理与持久化

- 用户提供 Linux 客户端安装包和订阅。安装包已提取检查，其 KuaijiasuCore 需要桌面 IPC 控制，不能以普通配置文件独立作为无桌面服务运行；没有执行系统级 dpkg 安装，也没有安装桌面依赖。
- 改用兼容该订阅的官方 MetaCubeX/mihomo v1.19.32 linux-amd64-compatible 发行文件；压缩文件 SHA256 为 ba3ce607747a07f948fc35780e108a4a7c7f552a38b9bd4d115f313ebcb89c20，与 GitHub release digest 一致。
- 私有部署目录 /data/fqd/.local/share/codex-proxy，目录 0700；订阅、节点配置、代理凭据和环境文件均仅存在 110，权限 0600，不下载到本机，不提交 Git。
- 只监听 127.0.0.1:17890，启用代理用户名和随机密码；控制接口仅监听 127.0.0.1:17891，另有随机控制密钥。无认证代理请求实测返回 407，控制接口返回 401。没有启用 TUN、LAN 监听、系统代理或全机路由。
- 保留 TLS 证书验证：订阅中原来关闭验证的选项均改为开启验证。46 个节点的本轮逐节点探针中只有 1 个通过；保存其稳定身份指纹并优先使用，不把“导入 46 个”等同于“46 个都可用”。刷新订阅后不依赖原节点序号。
- codex-egress-proxy.service 为用户级常驻服务，Restart=always、3 秒重启间隔；codex-proxy-subscription-update.timer 每 12 小时刷新一次，开机后也安排刷新，带随机延迟。手动触发正式更新服务，Result=success、ExecMainStatus=0。订阅更新最终通过已认证的控制接口热重载，不重启代理进程；实测更新前后 PID 都为 1233654。
- fqd 的 .bashrc 加载私有 network.env，使新 SSH 用户会话和桌面远程 Codex 启动继承代理；因此作用域是 fqd 用户环境，不是全机，也不是只影响某一条聊天。保留原 shell 内容和局域网 NO_PROXY 设置。
- 旧共享后台定点停止后迁入 codex-shared-app-server.service，保留原 0.155.1 可执行文件；桌面连接进程重新建立，仍为 0.160.1。两个进程均已检查 HTTPS_PROXY/HTTP_PROXY 存在，未输出其值。没有重启实际承载 SSH 的 codex-ssh-endpoint.service。
- 上述代理、共享后台、原检索 worker 及订阅 timer 均 enabled，用户 Linger=yes。整机开机自启属于已配置的行为，未通过重启整台共享主机来实测。

### 工具补全与实际验证

110 的 unified_exec、shell_tool、shell_snapshot 本来就已默认开启；没有把未显式写入配置误判为关闭，也没有重复更改。全局 AGENTS.md 与本机 SHA256 相同，平台专属 Hook 和路径不强求字节相同。

本次新增：

- uv/uvx 0.12.17 用户级安装；uv --version 和离线 uv run 实际执行 Python 均通过。
- /data/fqd/.local/bin/codex-parallel 指向已有全局 DAG 调度器，可从不同工作区调用。
- 补齐 test-parallel-run.mjs 和 test-ready-work-evidence.mjs，调度重叠、依赖顺序、失败/超时回压、危险任务串行、硬上限 20、错误结果拒绝均通过。
- web_search 设为 live，真实模型产生 webSearch 工具事件并返回官方文档链接，不只检查配置值。
- 配置变更前做私有备份，写入后校验认证内容未变；本次未改模型、xhigh、权限策略或 Hook 文件。两个正式 Hook 仍 enabled/trusted，没有绕过信任。

| 验收项 | 结果 | 耗时/边界 |
| --- | --- | --- |
| 恢复后及订阅热重载后的无认证网络请求 | 两组共 12/12 通过，均经 110 本机代理返回 401 | 2.11–5.10 秒 |
| 直接 Responses | 200、completed、OK | 19.60 秒；代理初启时同轮 models 曾失败，未隐去 |
| 独立 Codex 最小聊天 | 两次 completed、OK | 12.29 / 19.06 秒 |
| 正式客户端连接共享后台 | completed、OK，客户端正常退出 | 持久化 turn 为 19,467 毫秒 |
| 真实模型八批次任务 | 8/8 摘要正确，实测峰值 8 | 工作窗口 495 毫秒，整轮 58.17 秒 |
| 不经过模型的同一八批次 | 8/8 正确，峰值 8 | 工作窗口 412 毫秒，总 508 毫秒 |
| 实时搜索 | completed，存在实际 webSearch 事件和官方链接 | 整轮 39.61 秒 |
| 代理异常退出恢复 | 只终止已验证身份的新代理主进程后自动拉起 | 3,201 毫秒，检索 PID 不变 |
| 订阅更新 | 正式 oneshot 服务成功、控制接口热重载 | PID 不变；旧配置先保留，验证通过后替换，重载失败恢复旧配置 |

真实八批次通过 8 条独立 commandExecution 和各批次起止时间、SHA256 结果判定重叠，不用“配置了并发上限”代替实测。该证据不是 100 个模型任务压测；之前 100 请求图检索的证据仍见下文，不重复宣称新增验收。

共享后台验收会话为 01a14f21-0e8f-73d2-a17c-53cde9eb70c9，turn 为 01a14f21-0f25-7332-9043-bb5babf33c52，持久化状态 completed、回复 OK。早先手写 JSONL 接入 app-server proxy 的诊断脚本发生 RPC 超时，是不适用于该控制协议的测试适配器；正式 --remote 客户端及持久化 turn 才是共享后台验收依据。未重放用户原会话的已中断任务，用户可回原聊天继续，无需重启 Mac 应用或重新信任 Hook。

收尾检索 worker PID 540443 未变，active/running，内存约 20.50 GB；新增代理约 23 MB。仍存在 CLI/共享后台版本不同和已有实验特性警告，未为了消除提示而隐藏警告或扩大升级范围。Mac 专属界面程序和原生 node_repl 未复制为 Linux 可执行文件，不能宣称两平台所有工具二进制完全相同。

新增安全证据位于服务器 /data/fqd/.codex/tmp/ 与本地 .reports/server110/：server110-ready-work-network-before.json、server110-ready-work-proxy.json、server110-direct-eight-result.json、server110-model-proxy-smoke.json、server110-model-proxy-repeat.json、server110-web-search-smoke.json、server110-proxy-timing.json、server110-proxy-recovery.json、server110-proxy-health.json、server110-proxy-backend-restart.json、server110-shared-proxy-summary.json、server110-runtime-final-proxy.json、server110-subscription-reload.json；热重载后的另一组探针另存本地 server110-proxy-timing-after-reload.json。部署和更新脚本仅在忽略的诊断目录及 110 用户私有目录，不包含订阅 token。节点字段实际落盘回执保存在本机忽略目录 `.reports/server110/network-task-tree-receipts.md`，不随 Git 分发。

参考已实际读取的 [Codex 配置说明](https://developers.openai.com/codex/config-reference) 与 [Mihomo 配置说明](https://wiki.metacubex.one/en/config/general/)。Stack Overflow 检索被人机验证拦截，未把未读帖子当依据。

## 前次验收记录：更换 API 并重启重连

- 用户指定新入口 https://ai.duckduckport.top，配置为其 Responses API 根地址 https://ai.duckduckport.top/v1；保留原 provider ID 以兼容已有会话引用，原模型 gpt-6.1-sol 和 xhigh 不变。
- 新密钥通过 Codex 正式 login --with-api-key 的标准输入保存，仅存在 110 用户私有认证存储中；没有写入仓库、命令参数或报告。原配置和认证的备份位于 /data/fqd/.codex/backups/api-switch-2026-10-18T12-12-39-431Z，目录权限 0700、文件权限 0600，不上传 Git。
- 原桌面连接的 app-server 已停止，远程适配器重新连接后启动新进程 951191（0.160.1），远程 read_thread 请求成功。共享后台由 PID 3782336 重启为 949737，保留其已有 0.155.1 可执行文件；控制 socket 可重新连接。原后台并非新 CLI 托管，内置 daemon restart 拒绝接管，因此只对验证过身份的 Codex 进程做定点重启，没有重启 SSH 服务。
- 常驻检索 worker 仍是 PID 540443、active/running；两个正式 Hook 仍为 enabled/trusted，多 Agent 和 20 路上限保持生效。
- 独立 Codex 0.160.1 的真实最小任务完成，最终回复 OK，总耗时 40,828 毫秒；SessionStart / UserPromptSubmit 为 107 / 125 毫秒。这是实际模型调用，不只是配置检查或 models 列表检查。
- 新密钥查询 models 返回 200，列出 9 个模型并包含当前模型；直接 Responses 请求也返回 200、completed、OK，该次 Responses 耗时 26,757 毫秒。网络探针重试时，models 查询曾耗时约 92 秒，因此不能把单次成功视为低延迟保证。
- 正式客户端重新连接共享后台后，也收到 final_answer 为 OK 的消息；期间出现一次流读取超时后重试。测试随后被手动中断收尾，持久化 turn 状态为 interrupted（110,909 毫秒），不是完整 turn 成功证据。独立 CLI 的 completed 证据与此分开记录。
- 第一次新接口的独立 CLI 测试仍曾 90 秒超时；未重做原 8 批次工具任务或 100 请求压测，不能借这次接口切换补称整轮高并行验收通过。

新增安全证据在服务器 /data/fqd/.codex/tmp/ 和本地 .reports/server110/：server110-api-switch.json、server110-backend-restart.json、server110-model-new-api.json、server110-model-new-api-retest.json、server110-runtime-new-api.json、server110-native-new-api-summary.json。本次任务树实际落盘的逐字段回执保存在本机忽略目录 `.reports/server110/api-switch-task-tree-receipts.md`，不随 Git 分发。下文的 403 和“保留原后台”是首次部署时的历史记录，不代表切换后的当前状态。

## 部署范围

| 内容 | 当前状态 |
| --- | --- |
| 统一提示词 | 9 份发布产物、76 条规则；发布器和路由校验通过 |
| 治理 Skill | 22 个，安装在 /data/fqd/.agents/skills |
| 外部 Skill | 15,472 个，安装在 /data/fqd/.codex/tools/skills |
| 统一 GraphToolCall 图 | 15,515 个工具节点，即 15,494 个 Skill + 21 个 task-tree MCP 工具 |
| 路径完整性 | 缺失、无效、非全局路径及残留 Mac/194 路径均为 0 |
| MCP | 原 Codex 后台的新会话中 task_tree 已连接，列出 21 个工具 |
| Hook | SessionStart 和 UserPromptSubmit 均在正式 Codex 界面审阅并信任，运行端显示 enabled/trusted |
| 注入节奏 | 固定提醒在第 1/4/7 轮注入；同一轮幂等，compact 后恢复调度契约 |
| 超时 | dispatcher 内部 60 秒；UserPromptSubmit 外层 65 秒，SessionStart 70 秒 |
| 调度配置 | 多 Agent 开启、会话上限 20，V5 并行调度契约；不代表模型已实际执行 20 路 |

图文件：/data/fqd/.codex/skill-registry/skills.graph.json。

源快照：/data/fqd/.codex/tools/ai-engineering-governance-template。全量资料为 64,936 个文件、1,022,336,696 字节、无符号链接，迁移前后整体摘要一致：

- 完整资料 SHA256：6df1591c9f6e23be0688f9a767e652215524efbbc6d805827accbc43ea5a94a6
- catalog SHA256：dd63f1d8b8ec26b6b6bd4ff2bdf5fd52c637964b1f7c202a746465cbebdbd54c

上述证明资料迁移完整、全局路径有效和检索可达，不代表逐个执行过 15,494 个 Skill 的全部内部功能。

## 常驻、开机与资源

用户服务：/data/fqd/.config/systemd/user/codex-graph-worker.service。

- 已 enabled、active/running，Linger=yes：配置为开机无需登录启动；没有实际重启整台共享服务器。
- 20 个检索子进程，最多 128 个在途请求、256 backlog，预过滤启用，数学库单线程。
- 图和离线 embedding 常驻，100 请求 socket 测试中各进程 loads=1，并非每次重新加载。
- Restart=always、RestartSec=3、StartLimitIntervalSec=0。本次部署的新服务经主进程异常退出后自动恢复，并重新预热；恢复后完整 Hook 压测通过。
- 另一个隔离恢复探针连续失败 6 次后第 7 次启动成功，未改变生产 PID。
- 收尾实测主 PID 540443，NRestarts=1，内存 20,435,914,752 字节，约 19.0 GiB；观察时无内存压力或 OOM。
- 配置 MemoryHigh=58G、MemoryMax=60G、CPUQuota=2000%。该主机 cgroup 缺少 cpu.max，不能把配置值当作已证实执行的 CPU 硬限。

运行环境：用户级 Python 3.10.12 虚拟环境，graph-tool-call 0.46.0、CPU Torch 2.6.0、sentence-transformers 6.1.0、transformers 5.20.1；pip check 通过，离线 MiniLM 实测输出 384 维且不使用 CUDA。

## 错峰并发实测

100 个唯一长查询，按秒到达数量为 10、5、20、25、40，单请求期限 55 秒。压测的是图检索/Hook，不是 100 个同时运行的大模型任务。

| 场景 | 成功 | P50 | P95 | 最慢 |
| --- | ---: | ---: | ---: | ---: |
| 初始 8 进程，socket | 87/100 | 32.918 秒 | 55.019 秒 | 55.020 秒 |
| 调整为 20 进程，socket | 100/100 | 14.602 秒 | 24.336 秒 | 26.489 秒 |
| 故障恢复后 20 进程，完整 Hook | 100/100 | 14.590 秒 | 26.018 秒 | 27.336 秒 |

8 进程时超时的 13 个请求来自最后一批。成功请求均只加载一次且启用预过滤，无内存压力；20 进程测试中 20 个实际查询 PID 均参与。结果支持池容量与排队解释，不支持“仍然完全串行”或“每次重载图”的解释。8 进程基线同时有一个真实 Codex Hook 请求，因此不是严格单变量学术实验。

完整 Hook 的 100 个请求均含路由输出、固定提醒和 V5 契约，无 stderr。该结果证明服务能够承接这组错峰请求，但 P95 仍约 26 秒，不能称为毫秒级，也不保证任意规模/查询长度均在该期限成功。

## 切换前的真实 Codex：未通过记录

真实 8 批次工具任务在 240 秒期限内未完成，没有获得工具执行重叠证据：SessionStart 102 毫秒、UserPromptSubmit 6,249 毫秒完成后，仍在等待模型。

进一步用旧 CLI 0.155.1、新 CLI 0.160.1 各自执行“不调用工具，只回复 OK”的最小测试，两者均出现重复 403，未完成回复。结构化探针在 9,320 毫秒收到 error.codexErrorInfo 内的 httpStatusCode=403；当次两个 Hook 分别在 102/125 毫秒完成，探针立即停止自己的临时任务。正式客户端连接原有 daemon 的测试也遇 403，随后已中断该测试轮次并关闭客户端。

当时只能确认拒绝发生在 Hook 完成后的模型调用边界，未推断认证失效，也未绕过拒绝。用户随后确认旧入口余额耗尽，并明确授权替换地址及密钥；切换后结果见上方最新验收，不再把旧 403 当作当前阻塞。

## 初次部署时对现有环境的保护

- 保留用户 gpt-6.1-sol、xhigh、provider、审批和沙箱设置；没有读取或复制认证文件。
- 系统 /usr/local/bin/codex 缺可选二进制依赖，未修改共享系统安装。用户 CLI 更新至 0.160.1，保留完整 0.155.1 和旧链接备份。
- /data/fqd/.local/bin/codex 指向用户安装；通过受管 .bashrc PATH 块修复非登录 SSH 仍选损坏系统 CLI 的问题。后续独立 SSH 验证路径及 codex-cli 0.160.1 正确。
- 没有重启原有两个 Codex app-server（PID 2905206、3782336），未停止其他用户服务。正式连接原后台的新会话可见 Hook 和 MCP；不保证已有会话的静态工具集全部热刷新。
- 去掉 AGENTS.md 重复生成块，保留非管理区域与个人 Skills。
- 服务与配置变更先备份：/data/fqd/.codex/backups/global-graph-2026-10-18T10-38-40.494Z 及 /data/fqd/.codex/backups/portable-profile/；不建议直接覆盖整个配置回滚，以免覆盖后续用户修改。

## 维护与证据

后续 Skill/MCP 更新应从上述用户级源快照更新全局库、刷新统一注册表，再验证路由与服务；不能把资料放到某个工作区的局部 Skills 目录。常驻服务保留，维护操作仍须有相应授权。

安全 JSON 证据在服务器 /data/fqd/.codex/tmp/，本地副本在 .reports/server110/，包括：

- server110-install.json：受管文件与备份、provider 保留、提示词摘要。
- server110-runtime-trusted.json、server110-final-runtime-config.json：正式 Hook 信任、模型及并发开关。
- server110-cadence.json：第 1/4/7 轮、幂等、compact 验证。
- server110-socket-100.json、server110-socket-100-p20.json、server110-hook-100-p20.json：失败与成功样本、实际查询进程及分位耗时。
- server110-systemd-recovery-probe.json：隔离恢复探针。
- server110-codex-ready-work.json：240 秒真实任务未完成。
- server110-model-smoke155.json、server110-model-smoke160.json、server110-model-error-detail.json：最小模型调用与结构化 403。

初次部署的任务树每次真实落盘节点/字段“旧值 → 新值”另存本机忽略目录 `.reports/server110/task-tree-receipts.md`，不随 Git 分发，直接来自 task_tree_write 的 changes；API 切换回执见最新验收。任务树精炼工具和 check-tree-compact.sh 均通过；本项目没有执行流程脚本，流程状态检查为不适用。全仓 PowerShell 发布门禁没有运行，本机无 pwsh，且 Skill 指定的 scripts/verify-repository.ps1 根路径不存在；不把这些算作通过。

本次没有提交或推送 Git，也没有执行 Windows/Linux 的跨平台发布检查。
