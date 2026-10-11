---
name: method-task-tree
description: Use only when the current project contains task-tree.md or task-trees.json, or when the user asks to inspect, edit, run, render, repair, or reason with llm-task-tree state. Do not trigger in projects without task-tree state. Prefer task_tree_* tools over manual Markdown edits when available.
---

# Task Tree Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary. The nearest project `AGENTS.md` may add stricter prerequisites.

## User's original wording — English translation

- [TT01] Call `task_tree_focus` at the start of every turn. If it returns an active execution scope, confirm this Agent's `assignedNodes` and writable nodes; only otherwise confirm `GraphState.Current`, `GraphState.Next`, and the Next node's `NextIdea`.
- [TT02] The execution priority is fixed as “user's latest requirements > this Agent's execution scope > global `GraphState.Next`”. When an execution scope exists, execute only assigned nodes; global Current/Next is merely the human project perspective, not a shared objective for all Agents.
- [TT03] Before execution, check the assigned action or `NextIdea` against the user's latest requirements and project evidence. If it is outdated or completed, do not redo it; write the measurement results and the next unresolved action back to this Agent's authorized nodes without moving the GraphState focus. When operating with an execution scope, overwriting the entire tree is prohibited; server-side field patches must be used, and nodes outside the authorized scope must be rejected.
- [TT04] A coherent work unit is an independently verifiable result, decision, failure, or blocker. After completing each unit, immediately update the smallest relevant active node through `task_tree_write` before starting another unit; postponing all task-tree maintenance until the end of the turn is prohibited.
- [TT05] Never execute `GraphState.NextPlan`: it is merely a user memo that may be outdated. Do not modify `GraphState.Current`, `Next`, or `NextPlan` unless the user explicitly authorizes the applicable project protocol.
- [TT06] Before ending a turn that changed project state, run `task_tree_check_compact` and `task_tree_flow_status` if the tools are available, and write the required step evidence for completed workflow work.
- [TT07] Active nodes retain only current core state: measured facts, active constraints, unresolved risks, decisions, and the next unresolved action. Raw logs, process narratives, discarded attempts, and detailed evidence should go in their respective designated files, not in the active task tree.
- [TT08] Write node semantic fields in concise Chinese by default. `LLM`, `token`, `API`, necessary names, IDs, paths, and URLs may be retained; complex English technical terms should be translated into Chinese or moved to evidence files. Pasting code, JSON, commands, formulas, raw data rows, stacks, and logs into nodes is prohibited.
- [TT09] The fundamental objectives, stage objectives, and definitions of success explicitly expressed by the user are stable anchors and must not be replaced with model-invented high-level abstractions. When writing `CurrentResult`, directly answer the relevant objective: preserve its original meaning, explain what capabilities or evidence are now available, what is still missing, and whether the objective can therefore now be claimed as achieved. Numbers are merely optional evidence; do not write only vague judgments such as “the direction is correct”, “progress has been made”, or “still needs improvement”.
- [TT10] After each successful task-tree or subtree write, provide the user with an itemized acknowledgment based only on the actual persisted `changes` returned by the write tool or API. Group by node and explicitly state each field's “old value → new value”; do not infer changes from memory, request parameters, or plans, do not report unchanged or protected fields, and do not merely say “updated a node” or give only a count of changes.
