---
name: method-engineering-execution
description: Use for code changes, architecture, debugging, dependency selection, software installation, implementation planning, reproduction work, integration, and product-level testing. Also trigger when an engineering failure must be localized through its real information flow. Do not trigger for explanation-only questions with no engineering decision.
---

# Engineering Execution Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When installing anything, prioritize drives D, E, and F
- If there is a code or engineering problem, first look up related questions on StackOverflow and then solve it; do not just make changes on your own without looking it up.
- Make architecture decisions for the long term. Temporary solutions of the form “do this first and replace it later” are not acceptable.
- First see how mature products solve the same problem; use proven patterns instead of inventing from scratch.
- Locate the first divergence: inspect the information flow through inputs, intermediate processing states, outputs, and actual consumers to find the first point where it diverges from the objective.
- Change course according to the failure mechanism: distinguish insufficient information, interface errors, semantic errors, evaluation errors, environment problems, and method errors; do not merely repeat retries or add patches for different failures.
