---
name: fix-regression-with-tdd
description: Reproduce and fix a confirmed regression by establishing a failing test before changing production behavior, then performing the smallest repair and regression verification. Use for bugs in previously working behavior. Do not use for exploratory diagnosis without authorization to fix or for greenfield features.
---

# Fix Regression With TDD

## Non-negotiable order

1. Describe the old expected behavior, current failure, first known bad boundary, and affected consumer.
2. Reproduce the failure outside the test suite when practical. If it cannot be reproduced, continue diagnosis rather than inventing a test.
3. Add the narrowest test that fails for the observed mechanism. Run it and record the expected failure.
4. Make the smallest production change that restores the invariant. Avoid unrelated refactoring while the regression signal is red.
5. Run the new test until green, then run adjacent tests for the same component and boundary.
6. Add contract or end-to-end evidence when the regression crosses a public interface or user journey.
7. Report the red evidence, repair, green evidence, and remaining unverified surfaces.

## Test quality

The regression test must fail against the buggy behavior for the right reason and pass after the fix without weakening assertions. Prefer observable behavior over private implementation details. Include a failure or boundary case when the root cause could recur through a nearby input.

## Exceptions

If no automated harness exists, first create the smallest repeatable harness. If reproducing the bug requires destructive data, production credentials, or an unavailable external state, stop and explain the blocked evidence; do not claim TDD completion.

## User requirement — original wording translated into English

> “Do not take only the minimum subset. Absorb as much as possible, and carefully inspect functional, performance, and security testing.”
