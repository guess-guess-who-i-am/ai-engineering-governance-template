---
name: method-engineering-execution
description: Use for code changes, architecture, debugging, dependency selection, software installation, implementation planning, reproduction work, integration, and product-level testing. Also trigger when an engineering failure must be localized through its real information flow. Do not trigger for explanation-only questions with no engineering decision.
---

# Engineering Execution Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When installing anything, prioritize the D, E, and F drives.
- If there is an engineering problem in the code, first search StackOverflow for related issues and then solve it; do not blindly modify it on your own.
- Do not retain backward compatibility. Delete obsolete things directly; do not add a compatibility layer, write a migration, or leave a fallback.
- Choose an implementation that meets the current requirements. Do not introduce preventive abstractions or unnecessary configuration layers.
- Keep the system layered. First get a minimal end-to-end version working, then add more on top. Never break apart something that runs just to accommodate unfinished complexity.
- Keep components modular and focus on separation of concerns.
- Prefer mature, maintained libraries. Do not rewrite things yourself without a clear reason.
- First check what the project's existing dependencies can do, then consider adding a new package or writing it yourself. Do not assume at the outset that the libraries do not have it.
- Make architectural decisions for the long term. Do not accept a temporary solution of “do it this way for now and replace it later.”
- First see how mature products solve the same problem, use validated patterns, and do not invent from scratch.
- Locate the first deviation: inspect the information flow through inputs, intermediate processing states, outputs, and actual consumers to find where it first deviates from the goal.
- Change the route according to the failure mechanism: distinguish insufficient information, interface errors, semantic errors, evaluation errors, environment problems, and method errors; do not repeatedly retry or add patches for different failures.
