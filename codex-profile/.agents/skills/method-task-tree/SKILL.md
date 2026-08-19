---
name: method-task-tree
description: Use only when the current project contains task-tree.md or task-trees.json, or when the user asks to inspect, edit, run, render, repair, or reason with llm-task-tree state. Do not trigger in projects without task-tree state. Prefer task_tree_* tools over manual Markdown edits when available.
---

# Task Tree Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary. The nearest project `AGENTS.md` may add stricter prerequisites.

## User's original wording — English translation

- [TT01] Call `task_tree_focus` at the start of each round. If it returns an active execution scope, confirm this Agent's `assignedNodes` and writable nodes; only otherwise confirm `GraphState.Current`, `GraphState.Next`, and the `NextIdea` of the Next node.
- [TT02] Execution priority is fixed as “the user's latest requirements > this Agent's execution scope > global `GraphState.Next`.” When an execution scope exists, execute only the assigned nodes; global Current/Next are the human project perspective, not the shared objective of all Agents.
- [TT03] Before execution, use the user's latest requirements and project evidence to check the assigned action or `NextIdea`. If it is expired or complete, do not redo it; write the measurement result and next unresolved action back to this Agent's authorized node, without moving the GraphState focus. When an execution scope is present, whole-tree coverage is prohibited; server-side field patches must be used, and unauthorized nodes must be rejected.
- [TT04] A coherent work unit is an independently verifiable result, decision, failure, or blocker. After completing each unit, immediately update the minimum relevant active node through `task_tree_write`, then begin another unit; postponing all task-tree maintenance until the end of the round is prohibited.
- [TT05] Never execute `GraphState.NextPlan`: it is only a possibly outdated user memo. Unless the user explicitly authorizes the applicable project protocol, do not modify `GraphState.Current`, `Next`, or `NextPlan`.
- [TT06] Before ending a round that changed project state, if the tools are available, run `task_tree_check_compact` and `task_tree_flow_status`, and write the required step evidence for completed workflow work.
- [TT07] Active nodes retain only the current core state: measured facts, active constraints, unresolved risks, decisions, and the next unresolved action. Put raw logs, process narratives, discarded attempts, and detailed evidence in their designated files; do not put them in the active task tree.
- [TT08] Node semantic fields should be written in concise Chinese by default. `LLM`, `token`, `API`, necessary names, IDs, paths, and URLs may be retained; complex English technical terms should be translated into Chinese or moved to evidence files. Code, JSON, commands, formulas, raw data lines, stack traces, and logs must not be pasted into nodes.
- [TT09] The fundamental goals, stage goals, and success definitions explicitly expressed by the user are stable anchors and must not be replaced by high-level abstractions invented by the model. When writing `CurrentResult`, directly answer the relevant goal: retain the original intent of the goal, state what capabilities or evidence are currently available, what is still missing, and therefore whether the goal can now be claimed as achieved. Numbers are optional evidence; do not write only vague judgments such as “the direction is correct,” “there has been progress,” or “it still needs improvement.”
- [TT10] After every successful task-tree or subtree write, report to the user item by item based only on the actual persisted `changes` returned by the write tool or API. Group by node and clearly state each field's “old value → new value”; do not infer changes from memory, request parameters, or plans, do not report unchanged or protected fields, and do not merely say “updated a node” or give only the number of changes.
