---
name: test-api-business-flow
description: Create and run a multi-step API or cross-service business Flow against a real running entrypoint. Use when a User Story or Journey crosses interfaces and needs chained assertions. Do not use as a replacement for unit, browser, migration, load, or security tests.
---

# Test API Business Flow

## Workflow

1. Read the target Story or Journey, owning contracts, environment rules, and existing `.kest/flow/` scenarios.
2. Select one user-observable scenario and name it with the stable `US-nnn` or `UJ-nnn` ID.
3. Encode setup, authentication, requests, captured variables, state changes, and assertions for the main result plus one relevant validation, permission, duplicate, dependency, or recovery path.
4. Use environment variables and synthetic data. Never embed credentials, production identifiers, or personal data.
5. Make cleanup or unique data generation explicit so the Flow can be repeated.
6. Run the project-pinned Flow entrypoint against the intended environment with strict assertions and a machine-readable report.
7. Record the command, tool version, commit, environment, result, and evidence path.
8. Update the Flow with its public contract and search for stale routes, fields, status values, and error vocabulary.

A passing API Flow does not prove browser layout, database recovery, capacity, or authorization implementation quality. If the API, tool, or test data is unavailable, report the exact blocker instead of substituting retries or a mock.

## User Request - Original Wording Translated Into English

> "There are development standards summarized by other colleagues in this directory. Review them and take their strengths to supplement our system."
