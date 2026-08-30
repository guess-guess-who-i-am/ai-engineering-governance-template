---
name: review-project-diff
description: Review a branch, commit, pull request, patch, or working-tree diff for concrete behavioral defects and insufficient evidence. Use after implementation or when the user asks for code review. Do not use for a broad governance-system audit or to implement fixes unless explicitly requested.
---

# Review Project Diff

## Goal

Find actionable defects introduced by the target diff. Prioritize user-visible behavior, security, data integrity, contracts, and regression risk over style preferences.

## Workflow

1. Freeze the review target: base, head, included local changes, and the user's intended outcome.
2. Read the nearest instructions, changed files, direct consumers, and tests. Inspect surrounding code only when it changes the interpretation of the diff.
3. Trace each changed behavior from input to observable output. Look for missing failure paths, stale consumers, unsafe defaults, compatibility breaks, and evidence gaps.
4. Reproduce or prove each candidate finding with the narrowest available command, fixture, or code path. Do not report speculation as a defect.
5. Assign `P0` through `P3` using the repository priority policy. Give each finding a tight location, trigger, impact, and remediation direction.
6. Report findings first. If none remain, state that explicitly and list the surfaces actually reviewed and any unverified risks.

## Finding standard

A finding must identify all of:

- the behavior that is wrong;
- the condition that triggers it;
- the concrete consequence;
- evidence tying it to the reviewed diff;
- a small, actionable correction direction.

Do not inflate uncertainty into a finding. Do not hide a real behavior defect inside a general summary.

## Stop conditions

Stop and request direction when the base revision is unknown and different bases materially change the result, or when verification requires credentials, destructive external actions, or access outside the user's scope.

## User requirement — original wording translated into English

> “The test results should be improved in priority order.”
