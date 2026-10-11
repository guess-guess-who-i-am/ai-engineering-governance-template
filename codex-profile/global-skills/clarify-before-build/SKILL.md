---
name: clarify-before-build
description: Freeze goals, users, scope, constraints, acceptance evidence, and unresolved high-impact decisions before implementation. Use for new products, architecture changes, irreversible choices, ambiguous redesigns, or requests where different interpretations would materially change the result. Do not use for small reversible edits whose intent is already clear.
---

# Clarify Before Build

## Workflow

1. Inspect the repository, nearest instructions, current behavior, and existing evidence first.
2. Restate the requested outcome in observable terms without replacing the user's wording.
3. Separate known facts, safe assumptions, unresolved decisions, and out-of-scope work.
4. Map the critical path from input through implementation to the actual consumer.
5. Define acceptance evidence before choosing architecture. Reuse existing tests, contracts, standards, and production behavior when available.
6. Research only unresolved choices that would change the implementation. Prefer authoritative product documentation and mature comparable systems.
7. If one unresolved decision still changes data ownership, public contracts, destructive behavior, security, or product direction, ask one concise question and pause that branch.
8. Otherwise record assumptions and proceed with the smallest end-to-end slice.

## Output contract

Produce a short build brief containing:

- outcome and intended user;
- in-scope and explicitly out-of-scope behavior;
- authorities and constraints;
- first end-to-end slice;
- acceptance evidence;
- unresolved risks and the next decision.

Do not turn ordinary implementation into a planning ceremony. Do not invent numeric thresholds when an existing standard or baseline can be measured.

Read [references/build-brief.md](references/build-brief.md) when a written brief is needed.

