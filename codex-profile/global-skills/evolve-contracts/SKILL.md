---
name: evolve-contracts
description: Safely change HTTP APIs, events, schemas, CLI formats, shared types, or other interfaces consumed across component boundaries. Use when producers and consumers must evolve together, including breaking changes explicitly requested by the user. Do not use for private local refactors with no external consumer.
---

# Evolve Contracts

## Workflow

1. Identify the owning contract and every real producer and consumer. Search source, tests, examples, docs, fixtures, generated clients, and automation.
2. Capture current observable behavior: shape, semantics, status or error vocabulary, ordering, pagination, authentication, idempotency, and timing guarantees when relevant.
3. Define the new contract in one authority before editing implementations.
4. Decide change policy from the request. If backward compatibility is not required, remove obsolete shapes and fallbacks rather than carrying both.
5. Update producer and consumers as one coherent unit. Keep unlike internal models separate and map explicitly at boundaries.
6. Add contract tests for success, failure, missing/invalid input, and the most consequential edge condition.
7. Search again for stale names, fields, routes, examples, and compatibility code.
8. Run the narrowest checks on each changed side, then an end-to-end contract flow.

Use `scripts/find-contract-usage.ps1` before and after the change. Read [references/contract-checklist.md](references/contract-checklist.md) for the evidence matrix.

