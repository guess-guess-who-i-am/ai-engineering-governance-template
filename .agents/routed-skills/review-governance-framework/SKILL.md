---
name: review-governance-framework
description: Audit an AI engineering governance framework across standing instructions, Skills, scripts, hooks, tests, CI, documentation, and evidence flow. Use for completeness, duplication, routing, token-cost, or enforceability reviews. Do not use for ordinary code-diff review.
---

# Review Governance Framework

## Goal

Determine whether the governance system routes Agents to the smallest correct context and turns important policy into enforceable evidence.

## Audit sequence

1. Establish the promised workflow and the real entry points used by humans, Agents, hooks, and CI.
2. Map each rule to one owner: standing instruction, project context, specialized Skill, contract, script, test, or CI workflow.
3. Trace representative tasks through routing, implementation, verification, reporting, and remediation. A document's existence is not proof that consumers use it.
4. Identify duplicated, contradictory, unreachable, over-broad, or prose-only rules. Check whether specialized context is loaded only when triggered.
5. Test deterministic validators with both passing and deliberately failing fixtures.
6. Compare claims in README and release material with observed commands and generated artifacts.
7. Report gaps by priority, owner, affected user story or gate, evidence, and remediation.

## Required coverage

Cover at least: instruction authority, Skill discovery and metadata, secrets, source provenance, user-story traceability, test categories, findings lifecycle, CI permissions, release readiness, documentation integrity, and upstream drift.

Treat third-party runtimes as integrations with explicit license and trust boundaries. Do not copy a product runtime into a template merely because its method is useful.

## Output

Lead with the present capability and highest-risk missing loop. Separate verified facts, inferred risks, and recommendations. If the user requests implementation, convert each accepted gap into a deterministic control or a narrowly triggered Skill and verify it.

## User requirement — original wording translated into English

> “What else did the original repositories have that we still do not have—for example unified Agent naming, the ZGI website, the getdesign website, and improving test results by priority?”
