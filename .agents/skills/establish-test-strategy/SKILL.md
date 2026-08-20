---
name: establish-test-strategy
description: Establish or repair a complete project test system that traces user stories to executable functional, contract, end-to-end, accessibility, performance, security, supply-chain, compatibility, deployment, and data-quality evidence. Use when starting a project, choosing or changing its technical stack, adding CI, preparing a release, or discovering missing test categories. Do not use for running an already-defined focused test after a routine local edit.
---

# Establish Test Strategy

Turn product intent into risk-based, executable evidence without silently dropping test categories.

## Workflow

1. Read `PROJECT_BRIEF.md`, relevant user stories, `quality/gates.json`, the owning contracts, implementation seams, and existing tests.
2. Give every acceptance criterion a stable ID and map it to the lowest reliable test layer that can falsify the claim.
3. Complete the Story test-design matrix: success, business failure and recovery, boundary and repetition, performance and capacity, identity and permission, compatibility and historical data, durable data and side effects. Reference real ACs or give a concrete current `N/A` rationale.
4. Keep all required categories in `quality/gates.json`. Mark each `active`, `planned` with `requiredBeforeRelease=true`, or `not-applicable` with a concrete project-specific rationale.
5. Configure focused PR gates first, then release, nightly, performance, and qualitative profiles. Keep external credentials in CI secrets.
6. Start test design after requirements review, in parallel with development. Review cases before the first testable build, and require each runnable slice to hand off its commit, build, environment, entrypoint, and developer self-test.
7. For staged handoffs, cross-boundary tests, defect fixes, and release candidates, record the run in `requirements/test-runs/`. Check user-visible results plus applicable database, file, queue, audit, and external side effects; do not require this record for an ordinary local unit test.
8. Run the narrow test while iterating, then `scripts/check.ps1`. Run the release profile when claiming release readiness.
9. Report each user-visible claim, its AC ID, exact evidence, environment, and remaining unverified surface.

## Conditional references

- For writing or repairing stories and acceptance criteria, read [references/user-story-traceability.md](references/user-story-traceability.md).
- For choosing concrete tools and commands after the stack is known, read [references/stack-adapters.md](references/stack-adapters.md).
- For performance, security, supply-chain, accessibility, deployment, or evidence-strength decisions, read [references/quality-layers.md](references/quality-layers.md).

## Hard rules

- A missing category is invalid; `not-applicable` requires evidence, not convenience.
- “Positive and abnormal paths are covered” is not evidence; name the AC, input, assertion, and recoverable state.
- A test-run result must point back to an existing Story, AC, and traceable repository file or registered quality gate.
- A `planned` release gate must block release until replaced by a real command.
- A compile, lint, snapshot, screenshot, filename, or intended design is not behavior evidence.
- A Kest duration assertion is latency evidence, not load or capacity evidence.
- A local Lighthouse run is lab evidence, not a production Web Vitals claim.
- An LLM qualitative gate runs only after deterministic checks and never replaces them.
- Do not invent thresholds. Record the owner, environment, baseline, and change procedure.
