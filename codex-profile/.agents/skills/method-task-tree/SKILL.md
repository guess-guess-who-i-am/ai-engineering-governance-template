---
name: method-task-tree
description: Use only when the current project contains task-tree.md or task-trees.json, or when the user asks to inspect, edit, run, render, repair, or reason with llm-task-tree state. Do not trigger in projects without task-tree state. Prefer task_tree_* tools over manual Markdown edits when available.
---

# Task Tree Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary. The nearest project `AGENTS.md` may add stricter prerequisites.

## User's original wording — English translation

- [TT01] At the start of each turn, call `task_tree_focus`. If it returns an active execution scope, confirm this Agent's `assignedNodes` and writable nodes; only otherwise confirm `GraphState.Current`, `GraphState.Next`, and the Next node's `NextIdea`.
- [TT02] The execution priority is fixed as “the user's latest requirements > this Agent's execution scope > global `GraphState.Next`.” When an execution scope exists, execute only the assigned nodes; global Current/Next is merely the human project perspective, not a shared objective for all Agents.
- [TT03] Before execution, check the assigned action or `NextIdea` against the user's latest requirements and project evidence. If it is outdated or completed, do not redo it; write the measurement result and the next unresolved action back to this Agent's authorized node, without moving the GraphState focus. When an execution scope is present, overwriting the entire tree is prohibited; server-side field patches must be used, and out-of-scope nodes must be rejected.
- [TT04] A coherent unit of work is an independently verifiable result, decision, failure, or blocker. After completing each unit, immediately update the smallest relevant active node through `task_tree_write` before starting another unit; postponing all task-tree maintenance until the end of the turn is prohibited.
- [TT05] Never execute `GraphState.NextPlan`: it is only a potentially outdated user memo. Do not modify `GraphState.Current`, `Next`, or `NextPlan` unless the user explicitly authorizes an applicable project protocol.
- [TT06] Before ending a turn that changed the project state, run `task_tree_check_compact` and `task_tree_flow_status` if the tools are available, and write the required step evidence for completed process work.
- [TT07] Active nodes retain only the current core state: measured facts, active constraints, unresolved risks, decisions, and the next unresolved action. Raw logs, process narratives, discarded attempts, and detailed evidence should be placed in their respective designated files, not in the active task tree.
- [TT08] By default, write node semantic fields in concise Chinese. `LLM`, `token`, `API`, necessary names, IDs, paths, and URLs may be retained; complex English technical terms should be translated into Chinese or moved to evidence files. Pasting code, JSON, commands, formulas, raw data rows, stacks, and logs into nodes is prohibited.
- [TT09] The fundamental objectives, stage objectives, and definitions of success explicitly expressed by the user are stable anchors and must not be replaced by high-level abstractions invented by the model. When writing `CurrentResult`, directly answer the relevant objective: preserve the objective's original meaning, explain the capabilities or evidence now available, what is still missing, and therefore whether the objective can now be claimed as achieved. Numbers are only optional evidence; do not write only vague judgments such as “the direction is correct,” “progress has been made,” or “further improvement is still needed.”
- [TT10] After each successful task-tree or subtree write, acknowledge changes to the user item by item based only on the actual persisted `changes` returned by the writing tool or API. Group them by node and explicitly write each field's “old value → new value”; do not infer changes from memory, request parameters, or plans, do not report unchanged or protected fields, and do not merely say that “a node was updated” or provide only the number of changes.
