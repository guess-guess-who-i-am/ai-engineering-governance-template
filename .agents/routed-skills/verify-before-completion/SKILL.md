---
name: verify-before-completion
description: Select and execute proportionate evidence before claiming a task complete. Use when implementation spans multiple boundaries, the correct verification is unclear, the change is high risk, or the user explicitly asks for rigorous validation. Do not use to inflate routine edits with unrelated full-suite checks.
---

# Verify Before Completion

## Workflow

1. Restate the requested outcome and list the observable claims that would be made in the final response.
2. Map each claim to its real consumer and the narrowest evidence capable of falsifying it.
3. Reuse successful unchanged checks. Do not rerun merely for ceremony.
4. Run focused static, unit, integration, contract, end-to-end, security, performance, or visual checks according to the changed boundaries.
5. Exercise the main path like a user, then vary one relevant input or condition to test understanding.
6. For qualitative intent or taste, add a blinded LLM gate only after measurable checks pass. Require concrete cited evidence and calibrate it against at least one known-good and one deliberately degraded artifact when such artifacts are available.
7. Record command, scope, result, and limitations. A command that did not run is not evidence.
8. Claim completion only when every requested behavior has evidence and no required work remains. Otherwise state the exact blocker or unverified surface.

Run `scripts/verify-repository.ps1` for this template. Read [references/evidence-ladder.md](references/evidence-ladder.md) when selecting checks.

