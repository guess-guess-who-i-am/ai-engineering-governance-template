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
- Notes: 只支持 macOS；22 个 Skill 统一安装到用户级目录，项目 Skill 源不参与运行时注册。Hook 信任由 Codex 交互式审核记录，不能由安装器伪造。
- CurrentResult: macOS 安装器已在真实用户目录运行；全局索引为 codex 6、agents 22、插件 7，项目来源为 0。63 条方法论规则、20 并发、Hook 信任和全局-only 路由均通过测试，当前目标可声明达到。
- RootCauseAnalysis: 原实现同时维护 Linux/Windows 入口并把项目目录加入 Skill 注册，造成平台边界和运行时来源不清；本轮删除旧 profile 入口，统一 macOS Node 安装路径和全局 Skill 根。
- CaseStudy:
- NextIdea: 在本机重新运行 macOS 安装器的 `--check`，确认后续方法论发布仍保持全局-only 注册表。
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
