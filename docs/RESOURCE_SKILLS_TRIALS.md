# 完整 Skill 包接入前的静态审计与真实脚本试用

本报告覆盖统一资源库的 2,883 个首选 Skill 包，不拆分、改写或修复原包。全部可建立全局图节点；“能检索到”不代表“原包承诺的功能都可靠”。本次没有调用收费模型、远程业务写入或安装依赖。

## 可复现入口

```sh
node scripts/audit-resource-skills.mjs --self-test
node scripts/audit-resource-skills.mjs --output .reports/resource-integration/skills-audit.json
node scripts/audit-resource-skills.mjs --trials --output .reports/resource-integration/skills-audit.json
```

来源默认位于当前用户的 `Desktop/破解workbuddy/统一资源库`；可用 `--root` 指定，脚本不修改该目录。试用输入和输出仅写入系统临时目录。机器证据保存到 `.reports/resource-integration/skills-audit.json`，包含每个包的原描述、包路径、入口哈希、附件/脚本列表、审计线索及每次试用命令、时间、退出码、输出。

## 描述与可迁移性诊断

2026-10-24 首次实测，20 路独立文件读取完成 2,883 包静态检查约 526 ms。

| 检查 | 数量 | 对接入的含义 |
|---|---:|---|
| 缺 description | 13 | 需在外部索引记录中提供有依据的摘要；不改原包正文 |
| 旧单行解析器丢失后续描述 | 450 | 必须正确读取折行、多行标量，不能把 `>` 或 `\|` 当作能力描述 |
| 描述没有中文 | 1,100 | 需要多语检索或独立双语检索字段；这不证明现有多语模型检索失败 |
| 正文出现宿主工具线索 | 269 | 检索后检查具体工具是否可用；匹配只是审计线索 |
| 正文出现宿主路径线索 | 1,010 | 保留原包与相对路径，并确认插件根目录/环境变量 |
| 相对 Markdown 链接疑点 | 134 | 含示例路径假阳性，不应直接判定 134 包损坏 |
| 没有 frontmatter | 7 | 图索引可通过包级 manifest 提供元数据 |
| 描述短于 24 字符 | 27 | 需要结合正文检查信息是否充分，不能按长度直接淘汰 |
| 触发范围可能过宽 | 19 | 只做人工复核线索，不等同自动禁用 |

统计采用受限标量提取器，支持常见单行、折行、`>`/`|` 描述，未宣称完整 YAML 合规校验。相对链接检查不覆盖代码字符串中的路径和完整传递依赖。许可字段是原作者的入口声明，不等于已独立核实的再分发权。

索引建议保存 `kind`、`packageRoot`、`entry`、`description`、`entryHash`、依赖与验证状态。原正文和所有附件仍以完整包为调用单位；中文检索补充放在索引侧，不拆原包。没有 description 的包可用正文标题和首段生成待复核摘要，不能悄悄当成已验证能力。旧解析器问题的实际代码位于 `codex-profile/mac/hooks/refresh-skill-registry.mjs` 的 `frontmatterValue`。

## 三个完整 Skill 包的试用

试用前已读完三个 `SKILL.md`，引文格式任务还读取其 BibTeX 格式参考。三个入口均声明 MIT；没有在这三个 Skill 根内发现独立 LICENSE 文件，因此本轮仅本地试用，不据此公开镜像原包。

本次执行的是原包提供的真实辅助脚本，输入为隔离的合成任务数据；未测全套 LLM 决策、论文外部真实性或第三方服务。共 8 例，4 例达到预期、4 例暴露缺陷。不是随机样本，不能把 50% 当作整个库的准确率。

| 完整包 | 实际任务 | 结果 |
|---|---|---|
| `citation-management` | 清理两条引文、规范 DOI、作者和页码、按 DOI 去重 | 通过，保留一条，页码 `1--10` |
| 同上 | 保留标题 `{DNA}`/`{RNA}` 和机构作者双大括号 | 失败：标题截成 `Learning with {DNA`，作者括号失衡，但退出码 0 |
| 同上 | 按 SKILL 文档执行 `--validate` | 失败：实际 CLI 不接受参数，退出码 2 |
| `scholar-evaluation` | 八个维度均 4 分，汇总加权分 | 通过，4.00/5 |
| 同上 | 仅评价 methodology=4，归一化可选维度 | 失败：得到 20.00/5，还建议投稿；退出码 0 |
| 同上 | 输入越界评分 6 | 通过，明确报错并退出码 1 |
| `budget-balance` | 四人四天，核对总价、人均、未超预算 | 通过，总价 4,796、人均 1,199，无超支取舍 |
| 同上 | 同一行程预算降至每人 1,000，核对节省建议 | 失败：酒店/餐饮的“人均节省”返回 540/240，应为 135/60，缺少除以四人 |

首次每例进程耗时 25–29 ms；这些是标准库辅助脚本时间，不是 Agent 端到端速度。没有可读的模型 token 计量，故 token 为 unknown，没有伪造 token 节省或整体准确率提升。报告保存了输出、期望和实际值。

`budget-balance` 还依赖包外的城市价格基准：本次显式通过 `--bench` 提供输入，不代表该子目录单独复制就完整可运行。它属于 `lazy-travel-planner` 专家模块；实际部署应保留专家模块全目录及数据。

具体适配：原脚本用 `Path(__file__).parent.parent.parent.parent`，没有先 `resolve()`。直接执行统一库 `skills/budget-balance/scripts/balance_budget.py` 时，默认基准落到统一库的 `data/price_benchmark.json`，实测不存在；解析后的真实脚本则属于完整 `lazy-travel-planner/skills/budget-balance/scripts/`，其专家根下基准文件存在。统一库的 `experts/lazy-travel-planner` 也保留了基准数据。全局安装应从完整专家包的 `skills/budget-balance/scripts/` 调用，或显式传入 `--bench <完整专家包>/data/price_benchmark.json`；不能把独立 Skill 文件夹安装成功当作默认数据依赖已经闭合。

## 接入结论与验证边界

上述三个包均可作为完整包进入图索引；已试用包应附 `known-helper-failure` 状态和具体失败范围，避免命中后把出错脚本当验收证据。原包保持不变，不能靠修改结果或把失败隐藏为成功来宣称好用。后续若修复应成为有测试的明确派生版本，当前并未实施。

来源路径按统一库相对位置分别是 `skills/citation-management`、`skills/scholar-evaluation`、`skills/budget-balance`；确切本机完整路径和哈希在 JSON 中。完整库来源目录目前为符号链接，迁移时必须复制完整内容及闭包，不能只搬符号链接。

审计脚本另测试了不存在来源目录：明确 ENOENT、退出码 1，没有写出伪造成功报告。受限描述提取器的三项自检通过。本报告未宣称完成全部 2,883 包的业务验收，也未完成全局图召回测试；后者由整合测试单独记录。
