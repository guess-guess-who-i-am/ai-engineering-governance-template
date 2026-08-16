# LLM Task Graph

> 这个文件是大模型和前端共同维护的任务图。每个项目一棵独立的树。

## ROOT - <填写你的项目目标>

- Position: 120,120
- Size: 400,520
- Completion: 已完成
- Problem: 如何让用户通过 Codex 逐项填写项目资料，并一键生成独立私有 GitHub 项目？
- Approach: 先生成简短项目 brief，再用确定性脚本复制最小治理骨架、初始化 Git，并可选创建私有 GitHub 仓库；模型只负责澄清，不直接处理密钥。
- Input: 当前治理模板、GitHub CLI 登录状态、用户的项目想法。
- Output: 可执行的新项目向导、项目 brief、私有仓库初始化结果。
- Metrics: 向导可重复运行；缺少必填信息时停止；新目录可通过基础检查；GitHub 创建失败不丢失本地项目。
- Notes: 第一次使用时，请让 Agent 拆成 3-7 个节点；节点不写代码、原始数据或复杂英文术语。
- CurrentResult: 私有仓库发布前材料已就绪：可迁移包含37个受管文件、55条方法论和6个自建方法 Skills；临时新用户安装、秘密扫描及15项 PR 门禁均通过。尚未提交并推送，因此“完整上传”目标当前不能宣称达到。
- RootCauseAnalysis: 生成器必须从已提交模板导出，才能隔离母仓库未提交内容；定性 LLM 门禁默认排除，避免缺少新仓库 Secrets 时首推失败。
- CaseStudy:
- NextIdea: 提交并推送当前完整工作树，再核对远端提交、仓库私有性和本地工作树状态。
- SelectedSkills:

# GraphState
- ChainForceNext: 

- Current: ROOT
- Next: ROOT
- NextPlan: 与 Agent 一起把 ROOT 拆成 3-7 个节点，设置 Current/Next/NextPlan，然后按 llm-task-tree/AGENTS.task-tree.md 逐节点推进。

# Edges

## E1 - 待建立

- Endpoints: ROOT
- LabelOffset:
- Label: 待建立子任务边
- Notes: 拆分子任务后删除或替换本边
