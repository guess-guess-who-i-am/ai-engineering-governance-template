---
name: method-task-tree
description: Use only when the current project contains task-tree.md or task-trees.json, or when the user asks to inspect, edit, run, render, repair, or reason with llm-task-tree state. Do not trigger in projects without task-tree state. Prefer task_tree_* tools over manual Markdown edits when available.
---

# Task Tree Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary. The nearest project `AGENTS.md` may add stricter prerequisites.

## User's original wording — English translation

- [TT01] Call `task_tree_focus` at the beginning of every turn. If it returns an active execution scope, confirm this Agent's `assignedNodes` and writable nodes; only otherwise confirm `GraphState.Current`, `GraphState.Next`, and the Next node's `NextIdea`.
- [TT02] Execution priority is fixed as “the user's latest requirements > this Agent's execution scope > global `GraphState.Next`.” When an execution scope exists, execute only the assigned nodes; global Current/Next represents the human project perspective and is not the shared objective of all Agents.
- [TT03] Before execution, check the assigned action or `NextIdea` against the user's latest requirements and project evidence. If it is outdated or complete, do not redo it; write the measurement results and the next unresolved action back to this Agent's authorized nodes without moving the GraphState focus. When an execution scope is present, overwriting the entire tree is prohibited; server-side field patches must be used, and unauthorized nodes must be rejected.
- [TT04] A coherent work unit is an independently verifiable result, decision, failure, or blocker. After completing each unit, immediately update the smallest relevant active node through `task_tree_write` before beginning another unit; postponing all task-tree maintenance until the end of the turn is prohibited.
- [TT05] Never execute `GraphState.NextPlan`: it is only a user memo that may be outdated. Do not modify `GraphState.Current`, `Next`, or `NextPlan` unless the user explicitly authorizes an applicable project protocol.
- [TT06] Before ending a turn that changed project state, run `task_tree_check_compact` and `task_tree_flow_status` if the tools are available, and write the required step evidence for completed workflow work.
- [TT07] Active nodes must retain only the current core state: measurement facts, active constraints, unresolved risks, decisions, and the next unresolved action. Raw logs, process narratives, discarded attempts, and detailed evidence should be placed in their respective designated files, not in the active task tree.
- [TT08] By default, write node semantic fields in concise Chinese. `LLM`, `token`, `API`, necessary names, IDs, paths, and URLs may be retained; complex English technical terms should be translated into Chinese or moved to evidence files. Pasting code, JSON, commands, formulas, raw data rows, stacks, or logs into nodes is prohibited.
- [TT09] Fundamental objectives, stage objectives, and success definitions explicitly expressed by the user are stable anchors and must not be replaced by high-level abstractions invented by the model. When writing `CurrentResult`, directly answer the relevant objective: preserve the objective's original meaning, explain what capabilities or evidence are now available, what is still missing, and whether the objective can therefore now be claimed as achieved. Numbers are only optional evidence; do not write only vague judgments such as “the direction is correct,” “progress has been made,” or “further improvement is still needed.”
- [TT10] After each successful task-tree or subtree write, provide the user with an itemized acknowledgment based only on the actual persisted `changes` returned by the write tool or API. Group by node and explicitly state “old value → new value” for each field; do not infer changes from memory, request parameters, or plans, do not report fields that did not change or were protected, and do not merely say that “a node was updated” or provide only the number of changes.
