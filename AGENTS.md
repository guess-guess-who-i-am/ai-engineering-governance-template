# AGENTS.md

This repository stores reusable AI engineering-governance templates. The objective is not to collect as many prompts as possible, but to let Codex complete the correct implementation with the smallest relevant context and prove the result with real evidence.

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
| Specialized workflow | Router-selected `.agents/routed-skills/<name>/SKILL.md` |

When authorities conflict, the authority closest to the real behavior and with explicit ownership wins. Do not conceal the conflict with a compatibility layer.

## Implementation flow

For each turn, batch all already-known independent operations into one parallel tool wave (up to 8; normally 5–8 when available). With one shell tool, run them concurrently inside it; do not serialize independent work.
Before sending an ordinary-task answer, count the complete rendered text (including punctuation, Markdown, URLs, and English) and rewrite it until the total is <=300 characters; preserve the conclusion, decisive evidence/actions, verification status, and material limitations. For search tasks, stop when decision-changing evidence is sufficient and summarize only the strongest sources. Exceed this only when the user explicitly requests detail.

1. Discover: confirm current state, real consumers, and the first information-flow boundary.
2. Freeze: create a short build brief only for high-impact ambiguity.
3. Minimal closed loop: complete one runnable end-to-end path first.
4. Extend: add state, boundaries, and quality attributes on top of that path.
5. Verify: start with the narrowest evidence and add contract or E2E evidence when crossing boundaries.
6. Deliver: state the result, evidence, limitations, and the next unfinished item.

## Repository rules

- Put complete third-party mirrors in `upstreams/` and do not commit them to this repository. Record sources and pinned versions in `UPSTREAMS.md` and `.reports/upstreams.json`.
- Do not copy upstream source with unclear licensing into the core templates.
- Skills follow `.agents/routed-skills/README.md`; keep bodies concise and put deterministic logic in `scripts/`.
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
