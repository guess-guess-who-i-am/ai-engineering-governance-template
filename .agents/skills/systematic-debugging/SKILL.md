---
name: systematic-debugging
description: Diagnose bugs, regressions, flaky behavior, failing tests, performance anomalies, and integration mismatches by locating the first divergence in the information flow. Use when the user asks to investigate or fix an observed failure. Do not use for feature development without a concrete failure signal.
---

# Systematic Debugging

## Workflow

1. Preserve the exact failure signal: command, input, environment, expected result, actual result, and relevant output.
2. Reproduce with the narrowest reliable case. If reproduction is impossible, collect state without guessing.
3. Trace the information flow from input to the failing consumer. Inspect intermediate values and contracts.
4. Identify the first divergence, not the loudest downstream symptom.
5. Classify the mechanism: missing information, interface mismatch, semantic error, evaluation error, environment problem, timing/concurrency, or external dependency.
6. Form one falsifiable hypothesis and run the smallest discriminating test.
7. Implement the fix at the owning boundary. Avoid patches at downstream symptoms.
8. Add or update a regression check that fails before the fix and passes after it.
9. Vary one relevant condition to confirm the explanation generalizes.
10. Report root cause, changed boundary, evidence, and remaining uncertainty.

For engineering issues with uncertain platform behavior, search authoritative documentation and a relevant Stack Overflow discussion before changing code.

Read [references/evidence-record.md](references/evidence-record.md) when preserving a diagnostic record. Use `scripts/new-debug-record.ps1` to create one.

