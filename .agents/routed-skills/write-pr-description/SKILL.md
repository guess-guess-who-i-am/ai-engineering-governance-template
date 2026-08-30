---
name: write-pr-description
description: Draft or update a pull request description from the actual base-to-head diff, linked requirements, verification output, risk, rollout, and rollback evidence. Use immediately before opening or refreshing a PR. Do not use to invent evidence or replace code review.
---

# Write PR Description

## Evidence first

Read the PR template, base-to-head diff, commit history, relevant user stories or issues, and test results. Distinguish committed changes from unrelated working-tree changes. Never state that a check passed unless its output was observed for the current inputs.

## Structure

Write a concise description with:

1. **Outcome** — what a user or maintainer can now do.
2. **Scope** — the coherent behavior changed and explicit exclusions.
3. **Evidence** — exact checks run and their observed results; link artifacts when available.
4. **Risk** — likely failure surfaces, migrations, compatibility, security, and operational impact.
5. **Rollout and rollback** — only when the change affects deployment, data, public contracts, or irreversible state.
6. **Findings and follow-up** — linked issues for accepted non-blocking work, with priority and owner.

Use repository terminology and stable IDs. Keep implementation detail only when reviewers need it to evaluate risk.

## Consistency checks

Verify that the title describes one outcome, the body matches the actual diff, every claimed test exists, breaking changes are explicit, and no secret or local path is pasted. If evidence is missing, label it unverified or run the permitted check; never fill the gap with confident prose.

## Output boundary

Drafting text does not authorize creating a PR, posting comments, changing labels, or merging. Perform those external writes only when the user explicitly requests the corresponding action.

## User requirement — original wording translated into English

> “We have our own GitHub. In the future, development will basically happen there, and all of our work will be stored on GitHub.”
