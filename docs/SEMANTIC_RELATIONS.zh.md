# 全库语义关系与全局推荐

目标是让全部全局 Skill、专家和 MCP 进入同一张关系图，并能说明某个候选的替代能力、可能的前后步骤和互补工作流。节点参与处理，不等于每个节点都有足够证据连边；不能为了覆盖率制造关系。

## 建图链路

1. 读取全局图中每个入口的完整正文或 MCP Schema，记录内容指纹，收集明确的自然语言输入输出声明。没有明确声明的节点仍参与能力检索，但标记为 `capability-only`。正文中的示例与代码块不会被误作声明；这一步不执行第三方代码。
2. 复用当前全库中文能力向量，为每个节点生成两个能力近邻；对具备声明的生产者，以输出向量检索两个输入近邻。输入输出编码覆盖全部 token 的分块。余弦相似度仅用于生成候选，不作为关系为真的阈值。
3. 第一轮模型逐对判断 `similar_to`、`precedes`、`complementary` 或 `none`，引用双方证据编号。代码还原原文并检查所有候选 ID、证据范围与输出完整性；缺失或越界的结果不能发布。
4. 对每个接受项进行第二轮复核。复核隐藏原关系和理由，重新检查实际任务、领域、角色及方向；只有关系类型一致才进入最终注册表。泛用的“分析、报告、团队”等词不能证明有用关系。两轮使用同一配置模型，因此一致性仍不是外部真值。
5. 用入口指纹将可迁移注册表绑定到目标机图。完整正文变化会拒绝旧关系；专家只规范化自动生成的位置头，原始角色正文和适配说明仍完整参与指纹。现有 `requires` 保留，交接优先于互补和相似，均使用 GraphToolCall 原生关系。
6. 常驻 Worker 直接使用已加载的图和一跳关系。每个主候选最多显示一个语义关联提示，优先工作流关系，再按候选相似度排序。Hook 标注这是推断、条件性建议，不授权执行，也不证明实际数据格式兼容。查询时不重新扫描全库或调用建图模型。

所有工作区读取用户级同一张图；不会在项目中安装另一套 Skill。原有严格文件名产物交接路径继续提供具名产物证据。

## 重建与迁移

使用已安装的 Python 环境，先在独立工作目录生成候选，再完成双轮核验。现有模型提供方和凭据仅在进程内用于认证，不写入注册表、日志或 Git。不会向模型发送全局 Agent 指令、项目历史或工具执行授权。

```sh
python scripts/build-semantic-relations.py \
  --graph /path/to/global/skills.graph.json \
  --work /tmp/semantic-build \
  --output /tmp/semantic-build/first-pass.json --workers 6
python scripts/verify-semantic-relations.py \
  --graph /path/to/global/skills.graph.json \
  --work /tmp/semantic-build \
  --output /tmp/semantic-build/semantic-relations.json --workers 8
```

第二条可以在第一条运行期间加 `--follow --overlap-workers 4`，在生产者尚未完成时只占四路，第一轮结束后才使用八路。首次生产者错误时停止补发，传输错误有界重试并降低宽度；缺失候选或损坏格式会阻止整批发布；个别证据编号越界则审计并拒绝该关系。每个批次的区间、缓存、重试、失败和跳过情况保存在工作目录。模型漏 ID 或结构损坏时，拆成更小批次重新核验，最多三层；不会接受损坏父结果。

Python 不自动读取 macOS 系统代理。若该机器依赖代理，启动离线核验时设置标准 `HTTPS_PROXY` 环境变量，指向该机器已配置的代理；不要把源机器代理端口写成全局部署常量。

最终 `semantic-relations.json` 随 Hook 安装；直接运行全局构图即可加载。单轮产物缺少完整复核标志，构图会显式拒绝。复核缓存绑定模型、提示、图和证据内容，不能跨变更混用。

发布使用 `scripts/build-global-graph-cached.py` 的独立候选目录及 `scripts/publish-resource-graph.mjs --check` 验证入口、向量、源码和文件校验值，再正式发布。发布器以图文件为最后提交点，失败回滚。新机器先恢复原有完整资源包，再用该机器路径构图；注册表不携带部署入口绝对路径。

新增 Skill、专家或 MCP 后，正常全局构图仍可完成；旧入口复用有效关系，新入口明确标为待建关系。新资源的关系须重跑离线双轮流程。这里不会在每次用户请求时付出模型建图成本。

## 验证与边界

```sh
python scripts/test-semantic-relations.py
python scripts/test-artifact-relations.py
python scripts/test-graph-worker.py
node --test scripts/test-publish-resource-graph.mjs scripts/test-install-portable-resources.mjs
```

这些测试验证自然语言声明、证据索引、缓存污染拒绝、迁移指纹、源变更、原生图保存读取、并发与失败回压。模型校准使用隐藏好坏标签的固定正反例；它不是全库质量保证。必须另跑固定留出查询、关系盲审与真实 Hook，再报告测得的覆盖率、分歧、排名变化和延迟；不能仅凭边数声称任务成功率提高。

候选预算会漏掉更远的有用关系；没有枚举所有节点对。没有明确输入输出的正文也没有被宣称已完整理解隐含契约。真实跨工具执行还受凭据、宿主功能和数据格式约束。

## 方法依据

- [GraphToolCall](https://github.com/SonAIengine/graph-tool-call)：采用其原生关系及图遍历；没有把能力相似当成必须依赖。
- [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://proceedings.neurips.cc/paper_files/paper/2023/hash/91f18a1287b398d378ef22505bf41832-Abstract-Datasets_and_Benchmarks.html)，NeurIPS 2023：官方摘要明确讨论位置、篇幅、自我偏好和推理局限。本文采用隐藏原判断、正反校准并披露代理指标；论文结果不能直接移植为本系统准确率。
- [DeepEval](https://github.com/confident-ai/deepeval)：其公开 README 将工具选择、Agent 步骤与任务完成分开评测；本系统同样区分组件证据、推荐质量和真实执行。
