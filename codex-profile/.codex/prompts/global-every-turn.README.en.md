# Global methodology routing

The complete 126-rule English translation is preserved in `global-every-turn.en.md` as the canonical archive. It is not injected as a single block.

- Entry-time layer: `C:\Users\Administrator\.codex\AGENTS.md` and the nearest project `AGENTS.md`.
- Every-prompt reminders: `global-attention-anchor.en.md`.
- Every-prompt route index: `global-methodology-router.en.md`.
- Exact, non-overlapping partition: `global-methodology-map.json`.
- Routed full wording: `C:\Users\Administrator\.agents\routed-skills\method-*\SKILL.md`.
- Runtime Hook: `C:\Users\Administrator\.codex\hooks\context-refresh.ps1`.
- Mechanical integrity check: `C:\Users\Administrator\.codex\hooks\validate-methodology-routing.ps1`.
- Chinese review-only mirrors: `global-attention-anchor.zh.md`, `global-methodology-router.zh.md`, `global-methodology-routing-review.zh.md`, and `global-every-turn.zh.md`.

The Hook repeats the always-on English wording and route index on `UserPromptSubmit`, `startup`, `resume`, `clear`, and `compact`. It never injects the complete archive. The Skill recommender injects at most four strongly matching names, evidence, source labels, and exact paths; Codex reads full Skill bodies only after a direct match.

The partition contains 126 unique rule IDs: 43 always-on, 10 research, 20 engineering, 11 evaluation, 1 GitHub delivery, and 41 task-tree rules.
