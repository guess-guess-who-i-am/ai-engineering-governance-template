---
name: method-engineering-execution
description: Use for code changes, architecture, debugging, dependency selection, software installation, implementation planning, reproduction work, integration, and product-level testing. Also trigger when an engineering failure must be localized through its real information flow. Do not trigger for explanation-only questions with no engineering decision.
---

# Engineering Execution Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When installing anything, prioritize the D, E, and F drives.
- If there is an engineering problem with the code, first search StackOverflow for the relevant issue and then resolve it; do not modify it in isolation without researching it.
- Do not preserve backward compatibility. Delete obsolete things directly; do not add compatibility layers, write migrations, or retain fallbacks.
- Choose an implementation that satisfies the current requirements. Do not introduce anticipatory abstractions or unnecessary configuration layers.
- Design system layering for the long term. First get a minimal end-to-end version running, then build on top of it. Never dismantle something that works for the sake of unfinished complexity.
- Keep components modular and separate concerns.
- Prefer mature, maintained libraries. Do not rewrite something yourself without a clear reason.
- First examine what the project's existing dependencies can do, then consider adding a new package or writing it yourself. Do not begin by assuming that the library lacks the needed capability.
- Make architectural decisions for the long term. Do not accept temporary solutions of the form "do it this way for now and replace it later."
- First examine how mature products solve the same problem, and use proven patterns instead of inventing from scratch.
- Locate the first divergence: inspect the information flow through the input, intermediate processing states, output, and actual consumers to identify the first point where it diverges from the objective.
- Change course according to the failure mechanism: distinguish insufficient information, interface errors, semantic errors, evaluation errors, environment problems, and methodological errors; do not merely repeat retries or add patches for different failures.
