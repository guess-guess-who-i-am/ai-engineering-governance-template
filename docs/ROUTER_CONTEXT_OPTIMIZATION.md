# Router Context Optimization

## Scope

This change optimizes only the Hook rendering layer. It does not change GraphToolCall retrieval, the `expert:2 / skill:4 / mcp:2` category budget, candidate order, expert packages, MCP registration, or credentials.

The selected candidates are still retrieved by the resident GraphToolCall worker. A selected complete expert is an original package entry and workflow; the Hook does not execute that expert or invoke a second model. The current model must read the entry and perform its workflow. A missing host tool remains a blocker and must be reported.

## Evidence

The comparison used the same resident graph, 14 frozen bilingual challenge queries plus the current optimization request, and four concurrent workers. Baseline and candidate candidate lists were identical for 15/15 queries; the challenge target-name proxy was 7/14 in both. This is name recall, not task correctness.

The candidate Hook output decreased from 119,208 to 95,214 characters and from 131,918 to 107,954 UTF-8 bytes, a 20.13% character reduction. No tokenizer or model call was used, so this is not a token or end-to-end latency claim. Resident caches and scheduling confounded elapsed time; no speedup claim is made.

The optimization moves audit, execution-verification, and complete-expert instructions from every module entry to one shared block, while retaining each candidate description, read path, module identity, package, members, availability, and helper-failure warning.

## Actual expert use in this run

The current task retrieved `performance-testing-expert` as the relevant complete expert. Its original entry was read and its baseline/controlled-comparison workflow was followed for the router measurements. `skill-tester` was also retrieved, but its full procedure requires a host `Skill` tool that is not available in this runtime; it was not falsely claimed as executed. Irrelevant expert/MCP candidates were retained as negative retrieval evidence and were not run.

## Remaining gap

The frozen challenge still has misses and unrelated category occupants. The fixed category budget guarantees category coverage, not relevance. Improving recall/ranking requires a separate retrieval experiment with a ground-truth task set; this change intentionally does not add an unvalidated gate or reorder candidates.
