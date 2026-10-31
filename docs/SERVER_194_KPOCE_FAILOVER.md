# 194：KPOCE 主路由、Duck 故障备用

验收日期：2026-10-20。此次只调整 192.168.4.194 上 hyf 用户的现有模型路由配置，不发布 Git，不修改 110。

## 生效配置

Codex 继续使用本机入口 `http://127.0.0.1:1454/v1`，模型仍为 `gpt-6.1-sol`。

| 用途 | 路由 | 上游 |
| --- | --- | --- |
| 主路由 | kpoce | https://api.kpoce.sbs/v1 |
| 故障备用 | duckduckport | https://ai.duckduckport.top/v1 |

`router.env.bak-before-return-duck-20261019-141536` 中的主路由是 kpoce，因此用户提到的“另一个 K 开头的”按该历史配置确定为 KPOCE。

已更新 `/home/hyf/.codex/router.env` 的以下非敏感字段：

```ini
PRIVATE_DEFAULT_ROUTE=kpoce
PRIVATE_ALLOWED_ROUTES=kpoce,duckduckport
PRIVATE_BALANCED_ROUTES=kpoce
PRIVATE_ROUTE_CONCURRENCY_LIMITS=kpoce:30,duckduckport:30
PRIVATE_FALLBACK_ROUTES=duckduckport
PRIVATE_FALLBACK_ROUTES_KPOCE=duckduckport
PRIVATE_FALLBACK_ROUTES_DUCKDUCKPORT=off
```

Duck 不参与正常负载均衡。原先 `PRIVATE_FALLBACK_ROUTES_KPOCE=off` 会覆盖通用备用设置，已同时修正。回退只影响失败请求，后续新请求仍优先 KPOCE。没有修改路由器源码、公共路由、上游密钥或既有代理出口。

## 验收证据

- 应用前用路由器自身 `router.py --check` 验证成功。
- 从实际路由源码提取回退方法执行 17 项定向检查：主路由成功、401/402/403/408/429/500/502/503/524、连接失败、超时、两路均失败、普通 400、公共路由不回退，以及 Duck 不循环回退。此层使用模拟响应，不代表上游可用性。
- 重启 `codex-router.service` 后确认 `active/running`、自启状态 `enabled`；新进程初始环境没有覆盖上述路由字段。
- 通过正式 1454 入口真实请求：HTTP 200，收到 `response.completed`，文本与预期一致，耗时 **4.272 秒**。日志记录主路由 `kpoce`、状态 200，入队等待 0.000 秒。
- 隔离实例使用同一份路由器、同一份实际配置及真实 Duck 上游；仅在隔离实例内把 KPOCE 指向回 503 的测试服务。实测先收到一次主路由 503，随后记录 `kpoce → duckduckport`，Duck 返回 HTTP 200、完整回复且文本正确，耗时 **10.505 秒**。生产上游地址未为故障测试而修改，隔离监听在测试后关闭。

可复验脚本位于服务器 `/home/hyf/.codex/configure-kpoce-primary-20261020.py`，支持 `test`、`smoke`、`fallback-smoke`；脚本不包含密钥。密钥只由服务器现有配置在进程内使用，不输出到验收记录。

## 生效、回滚与边界

已重启路由服务，Codex 入口不变，用户无须重启 Codex 或重新信任工作区。配置保存在服务器，服务已启用开机自启，`loginctl show-user hyf` 确认 `Linger=yes`；本轮未实际重启整机。

旧配置已备份到服务器 `/home/hyf/.codex/route-backups/router.env.20261020T040630836064Z`，目录权限 0700、备份权限 0600；备份含认证配置，只留在服务器，不进入仓库。回滚应在服务器内恢复该文件并重启用户路由服务。

现有重试和超时策略未改变。验证覆盖主请求失败后的回退，不承诺已经输出内容的流可以无缝跨供应商续接。两条上游若同时不可用，仍会返回错误；一次成功不能证明长期稳定性。

## 任务树实际落盘回执

以下逐项来自 `task_tree_write` 的 `changes`，仅变更 ROOT 两个字段；图焦点和执行流程未变。精炼工具与 `check-tree-compact.sh` 均通过，2635 字节、零超预算字段；项目没有执行流程脚本，流程检查不适用。

- ROOT.CurrentResult：
  - 旧值：110自有代理与后台重连已验收：正式聊天19.47秒completed，两轮网络12/12成功；订阅热重载PID不变，异常退出3.20秒恢复，开机自启已配置。uv/uvx、全局并行入口和实时搜索可用，真实8批次8/8正确、实测峰值8，原20进程worker未重启。原中断消息未重放，整机重启未实测。
  - 新值：194已设KPOCE主路由、Duck故障备用，正式请求4.272秒完整回复；隔离主路由503后真实Duck10.505秒完整回复，17项定向检查通过，路由服务已启用自启且无需重启Codex，整机重启未实测。110此前代理与重连验收保留：网络12/12、真实8批次峰值8、原20进程worker未重启。三平台发布仍暂停，上游长期稳定性未证实。

- ROOT.NextIdea：
  - 旧值：用户可回原110聊天继续；后续若再慢，分别计时模型首字节、Skill路由和工具执行，三平台发布仍暂停。
  - 新值：用户可在194原Codex对话继续；若再失败，按KPOCE和Duck分别记录状态码、首字节和完整回复耗时，三平台发布仍暂停。
