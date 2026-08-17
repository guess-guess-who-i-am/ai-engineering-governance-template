# AGENTS.md

This repository stores reusable AI engineering-governance templates. The objective is not to collect as many prompts as possible, but to let Codex complete the correct implementation with the smallest relevant context and prove the result with real evidence.

## Quick task routing

1. First inspect `git status`, the latest implementation, relevant tests, and the user's latest request.
2. For an ordinary local change, read only the nearest code and tests; do not preload every document or Skill.
3. Read `CONTEXT.md` when the task changes global terminology, ownership, or boundaries.
4. Read `DESIGN.md` when the task changes the UI visual system.
5. Read `docs/DOCUMENTATION_AUTHORITY.md` only when fact ownership or required document linkage is unclear.
6. Read `docs/PROJECT_LIFECYCLE.md` when starting a project or Story, preparing integration, or making a release claim.
7. Read `docs/RESOURCE_REGISTRY.md` when adding persistent, scarce, paid, privileged, or data-bearing resources.
8. Load one primary Skill only when its trigger description clearly matches. `Pair with` text and reference links are not automatic chaining commands.
9. Rules that can be judged mechanically must be enforced by scripts, tests, contracts, or Flow, not by model self-report alone.

## Authority order

| Concern | Authority |
|---|---|
| User objective and definition of success | The user's latest request |
| Global terminology and ownership | `CONTEXT.md` |
| Visual language | `DESIGN.md` |
| Document ownership and lifecycle gates | `docs/DOCUMENTATION_AUTHORITY.md`, `docs/PROJECT_LIFECYCLE.md` |
| Persistent or shared resources | `docs/RESOURCE_REGISTRY.md` |
| Public interface behavior | Owning contract / schema |
| Local implementation rules | Nearest `AGENTS.md` and existing code |
| Specialized workflow | Triggered `.agents/skills/<name>/SKILL.md` |

When authorities conflict, the authority closest to the real behavior and with explicit ownership wins. Do not conceal the conflict with a compatibility layer.

## Implementation flow

1. Discover: confirm current state, real consumers, and the first information-flow boundary.
2. Freeze: create a short build brief only for high-impact ambiguity.
3. Minimal closed loop: complete one runnable end-to-end path first.
4. Extend: add state, boundaries, and quality attributes on top of that path.
5. Verify: start with the narrowest evidence and add contract or E2E evidence when crossing boundaries.
6. Deliver: state the result, evidence, limitations, and the next unfinished item.

## Repository rules

- Put complete third-party mirrors in `upstreams/` and do not commit them to this repository. Record sources and pinned versions in `UPSTREAMS.md` and `.reports/upstreams.json`.
- Do not copy upstream source with unclear licensing into the core templates.
- Skills follow `.agents/skills/README.md`; keep bodies concise and put deterministic logic in `scripts/`.
- Register persistent, scarce, paid, privileged, or data-bearing resources with an owner, review condition, and cleanup action.
- Do not commit tokens, cookies, API keys, `.env` files, or machine-local configuration.
- Preserve unrelated user changes and avoid destructive Git operations.
- Without evidence, do not claim “completed,” “fixed,” or “passed.”

## Verification budget

- Governance-document or Skill-only changes: run `scripts/validate-governance.ps1` and `scripts/validate-skills.ps1`.
- Script changes: run representative success and failure cases for the changed script.
- UI changes: add narrow/wide viewport, keyboard, accessibility, and qualitative gates.
- Contract changes: provide producer, consumer, failure-semantics, and end-to-end Flow evidence.
- Release boundary: run `scripts/check.ps1`; do not repeat the full gate when inputs have not changed.

## Common commands

```powershell
./scripts/update-upstreams.ps1
./scripts/validate-governance.ps1
./scripts/validate-skills.ps1
./scripts/check.ps1
```

<!-- llm-task-tree:begin -->
## Task Graph (llm-task-tree)

This project uses **`task-tree.md`** at the repository root as shared task state for agents.

**Prefer the `task_tree_*` MCP tools when they are available**

Registered for Codex via `[mcp_servers.task_tree]` in `~/.codex/config.toml`, and for Cursor via the committed `.cursor/mcp.json` (which points at `llm-task-tree/mcp-server.mjs`). When the tools are present, use them instead of hand-editing markdown:

- Read focus with `task_tree_focus`; read one node with `task_tree_node`.
- In multi-Agent work, create/read an execution scope with `task_tree_scope`. Priority is latest user request > this Agent's scope > global `GraphState.Next`. Only scoped target nodes are execution targets and only scoped writable nodes may be changed; global Current/Next remains the human project view.
- Write with `task_tree_write` (field-level). It backs up, enforces the compact gate, syncs flow status, and refuses `GraphState.Current/Next/NextPlan` — so focus stays the user's call.
- Scoped Agents must pass `scopeId` (or use the injected `TASK_TREE_EXECUTION_SCOPE`) and may not overwrite whole-tree Markdown. Node patches are serialized on the server against the latest tree, so concurrent writes to different authorized nodes are preserved.
- After a successful tree/subtree write, use only the tool/API's persisted `changes` result to tell the user every changed node and field as `old value → new value`. Never infer the receipt from memory or requested fields; omit unchanged writes and protected fields.
- `task_tree_chain` advances one chain step; `task_tree_flow_status` reports flow drift; `task_tree_check_compact` runs the gate; `task_tree_layout` re-arranges the canvas; `task_tree_knowledge` searches the local index.
- When the user wants to *work with* the graph, `task_tree_open` embeds the real UI in the chat (MCP Apps widget): dragging, editing, flow view, knowledge panel. When they only want a look, `task_tree_render` returns a picture. Both are for the user's eyes — read data with the other tools.
- `task_tree_server open` pops the UI on the user's desktop; use it when the host cannot render widgets.
- If a tool call fails, fall back to the file rules below and say so.

**Compact current-state rule**

`task-tree.md` is the current working graph, not an append-only history log. History lives in `versions/`.

- Before retaining a statement, apply the Core-State deletion test: if removing it cannot change the next action, method, live constraint, unresolved risk, or completion test, move it to evidence/another tree or drop it. Load `task-tree-core-state` when the tree is noisy or exceeds its total-size gate.
- Before acting, read ROOT and the active stage's `Problem`/`Approach`/`Metrics`, preserve user-stated goals, and derive how the current node serves them. If the link is not supported by the tree and latest user request, do not invent it. `CurrentResult` directly states verified present capability/evidence, the remaining gap, and whether the relevant goal can currently be claimed reached; numbers are optional. Concrete execution stays in `NextIdea` and evidence.

- After each coherent work unit (one independently verifiable result, decision, failure, or blocker), write the measured state to the smallest affected node before starting another unit; do not defer all task-tree maintenance until turn end.

- Replace or delete stale content instead of adding tombstones like "deleted on ...".
- Before adding text, refine the touched node/edge: remove duplicated, superseded, or process-only notes.
- Keep hard budgets: one `Problem`; current-only `Approach` <=4 bullets; `CurrentResult` is one goal-relative status with <=3 verified facts / 500 chars; `RootCauseAnalysis` <=2 sentences / 350 chars; at most 2 cases; one executable `NextIdea`.
- For big-tree cleanup, measure before/after bytes, lines, over-budget fields, and long lines (>240 chars). Touch the current path plus the top 8-15 over-budget nodes; target >=25% reduction in touched-node text and >=30% fewer long lines, unless preserved facts block that.
- Parent nodes are indexes, not storage bins: if a node has child/formula nodes, keep only the current conclusion, 2-3 key numbers, and child/file references.
- If old text conflicts with the current method, rewrite/delete the old text; do not keep both old and new methods live.
- Node semantic fields default to concise Chinese. Keep only familiar terms such as `LLM`, `token`, `API`, exact names, IDs, paths, and URLs; translate complex English domain terminology or move it to evidence.
- Do not paste code, JSON, commands, formulas, raw data rows, stack traces, or logs into nodes. This rule overrides older inline-sample examples in the frozen detailed protocol.
- `Input`/`Output` use a short Chinese evidence description plus optional real file paths; raw samples belong in previewable evidence files.
- Add a new node only for a genuinely separate subproblem with distinct input/output/metrics.
- If a method/order change affects execution order, also update `scripts/project.json` or `scripts/run.json`; CurrentResult-only edits usually do not.
- Tree saves/postflight automatically synchronize deterministic flow statuses and create minimal step evidence; Agents must still resolve missing/stale blocks and intentional order changes.
- Do not over-refine: preserve current measured facts, unresolved risks, user decisions, and active constraints.

**Every task — read-only tree context (default)**

1. If an Agent execution scope is active, execute only its assigned nodes; `GraphState.Current/Next` is background. Otherwise read `task-tree.md` and use `GraphState.Current`, `GraphState.Next`, and the **Next node's `NextIdea`**. `NextPlan` is a possibly stale user memo and MUST NOT be executed.
   This advisory-only policy overrides older executable-NextPlan wording retained in the frozen full protocol for audit compatibility.
   Also read ROOT `Problem`/`Approach`/`Metrics`; verify completed claims from evidence and do not treat plans, filenames, screenshots, or intended designs as proof.
2. Treat the tree as authoritative; chat history and orphan files are evidence only.
3. **Do not** Read `llm-task-tree/AGENTS.task-tree.md`, tree skills, or `scripts/README.md` unless this turn will **edit** the tree or **edit execution flow** (below).

**When you WILL edit the task tree** (write/create/repair `task-tree.md`, `subtrees/*.md`, nodes, edges, or GraphState)

Before any write, **must Read in order** (same turn, before editing):

1. `llm-task-tree/AGENTS.task-tree.md`
2. `llm-task-tree/AGENTS.node-writing.md`
3. `llm-task-tree/skills/task-tree-grill/SKILL.md`
4. `llm-task-tree/skills/task-tree-grill/references/schema-template.md`

Then back up `task-tree.md` to `versions/<timestamp>_<reason>.md` before manual edits (see protocol §7). Follow **all nodes → `# GraphState` → `# Edges`** order.

Cursor: `.cursor/rules/llm-task-tree-edit.mdc`

**When you WILL edit execution flow** (write `scripts/project.json`, `scripts/run.json`, or `PUT /api/flow-script`)

Before any write, **must Read in order** (same turn, before editing):

1. **`scripts/README.md`** — schema, block types, when to edit, when not to edit, saving, and backup (**the authoritative execution-flow format**)
2. Current **`scripts/project.json`** (and **`scripts/run.json`** if editing run mode)
3. Skim **`task-tree.md`** (+ relevant `subtrees/*.md`) for valid **`nodeId`** values

Then backup to `scripts/versions/project/` or `scripts/versions/run/` (or use API with default backup). **Execution order lives in scripts, not in node ID sort or graph layout.**

Cursor: `.cursor/rules/llm-task-tree-flow-edit.mdc` · Full gate: `llm-task-tree/AGENTS.task-tree.md` §1c

**End of task — only if you edited the tree or flow this turn**

1. Update the smallest relevant node(s) and/or `blocks`; for tree writes, report every persisted node/field difference as `old value → new value` from the write result.
2. For node `Input`/`Output`, write a short Chinese description plus optional paths; do not paste raw samples or code.
3. If flow changed, note it in the affected node's `Notes`.
4. If any tree/subtree changed, run `powershell -NoProfile -ExecutionPolicy Bypass -File llm-task-tree/check-tree-compact.ps1 <changed tree paths>`. Non-zero exit blocks completion: semantically rewrite every reported over-budget field and rerun until it passes. Never mechanically truncate facts. Codex Stop hooks enforce this automatically; other Agents must run it explicitly.

**No tree yet**

Create from `llm-task-tree/templates/task-tree.starter.md`, or run **task-tree-grill** (Read tree paths above first).

**UI**: `llm-task-tree/打开任务图.cmd` → **Relationship Graph | Execution Flow** for `scripts/project.json` / `scripts/run.json`.
<!-- llm-task-tree:end -->

<!-- llm-task-tree:tool-calling:begin -->
# Tool Calling Rules

When calling tools, follow these rules strictly. They override any conflicting habits from chat training.

## Argument formatting

1. **Omit optional fields you don't need.** Do not send `null`, `""`, `{}`, or `[]` as a placeholder. If a field is optional and you have no value, leave it out of the JSON entirely.

2. **Match the container type exactly.**
- Array fields take JSON arrays: `["a", "b"]`, never `"[\"a\",\"b\"]"` (string), never `{}` (object), never `"foo"` (bare string).
- Single-element arrays still need brackets: `["foo"]`, not `"foo"`.
- Object fields take JSON objects, not arrays or strings.

3. **Strings are raw strings.** Do not wrap values in extra quotes, code fences, or markdown.

4. **Numbers and booleans are unquoted.** `30`, not `"30"`. `true`, not `"true"`.

## Paths and identifiers

5. **File paths, URLs, IDs, and similar fields go to system functions, not chat output.** Never format them as markdown links, never wrap them in backticks, never add explanatory parentheses.

Correct: `"/Users/me/notes.md"`
Wrong: `"[notes.md](notes.md)"`
Wrong: `` "`/Users/me/notes.md`" ``
Wrong: `"/Users/me/notes.md (the notes file)"`

6. **If a tool description says "path", treat it as input to a filesystem call.** No formatting, no decoration.

## Related parameters

7. **When a tool has paired parameters (e.g., offset + limit, start + end, from + to), provide both or neither.** Read the description — if two fields work together, half the pair often produces an error.

## Recovery

8. **If a tool returns a validation error, read the error message carefully and fix only what it complains about.** Do not rewrite the whole call. Do not retry the same arguments.

9. **If a tool returns a "Note:" with a defaulted value, that's informational, not an error.** Continue the task. If the default is wrong, retry with the correct explicit value.

## Tool selection

10. **Use the tool whose description matches your intent most specifically.** Don't reach for `shellCommand` if a dedicated tool exists. Don't reach for `execute_code` for things a single tool call can handle.
<!-- llm-task-tree:tool-calling:end -->
