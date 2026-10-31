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
- Notes: macOS 全局安装已完成；Windows 脚本仍需在 Windows 主机验证。Hook 信任由 Codex 交互式审核记录，不能由安装器伪造。
- CurrentResult: 全局 profile 已安装到用户 Codex 目录：22 个仓库 Skill、全局基础索引 35 项；当前项目刷新后索引 51 项。63 条方法论规则、20 并发和 Hook 均通过本机验证；Hook 已信任并激活。剩余仅是 Windows 实跑验证。
- RootCauseAnalysis: 之前的全局状态只覆盖部分 Skill 和默认并发，导致路由、Hook 与配置没有形成闭环；本轮将安装器、注册表、方法论发布器和交互式信任统一到同一 profile，并用失败可见的并发测试验证边界。
- CaseStudy:
- NextIdea: 在 Windows 主机运行 PowerShell 安装器与仓库级检查，确认跨平台脚本和 22 个 Skill 的行为一致。
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
