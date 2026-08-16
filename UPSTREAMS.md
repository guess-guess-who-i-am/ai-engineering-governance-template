# 上游资料登记

`upstreams/` 保存调研和比较用的完整 Git 镜像，不进入本仓库提交历史。这样既能保留完整上游源码，又不会把第三方历史、许可证和大量业务代码混进我们的模板。

| 本地目录 | 上游仓库 | 用途 |
|---|---|---|
| `upstreams/awesome-design-md` | `VoltAgent/awesome-design-md` | `DESIGN.md` 设计系统目录 |
| `upstreams/taste-skill` | `Leonxlnx/taste-skill` | 前端设计与反模板化 Skills |
| `upstreams/emil-skills` | `emilkowalski/skills` | 动画、交互与 Apple Design Skills |
| `upstreams/kest` | `kest-labs/kest` | Markdown-native API Flow 工具 |
| `upstreams/luas` | `agicto/luas` | AI 工程脚手架、Agent 治理和验证门禁 |

审查后采用的固定版本提交到 `upstreams.lock.json`；`scripts/update-upstreams.ps1` 更新被忽略的本地镜像，`scripts/check-upstream-drift.ps1 -FailOnDrift` 只比较远端 HEAD 并输出 `.reports/upstream-drift.json`。漂移不会自动进入模板，必须先审查行为、许可证和我们的消费者，再更新 lock。

许可证核验：前三个设计/Skill 仓库和 LUAS 均包含 MIT License。Kest README 声称 Apache 2.0，但调研 commit `bf73f655c1b7cabc106244605cded9e2dd326ffa` 没有可检出的根许可证文件，GitHub License API 也返回 404；在维护者补齐前只用于本地研究和工具验证，不复制或重新分发其源码。

当前固定版本均与 2026-08-16 的远端默认分支一致。LUAS 从 `d3c4c76` 更新到 `6a2b2c9`，差异仅为依赖供应链脚本与 admin/web/contracts 的依赖和锁文件维护，没有新增被本模板遗漏的治理流程。
