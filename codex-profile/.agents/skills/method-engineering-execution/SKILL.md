---
name: method-engineering-execution
description: Use for code changes, architecture, debugging, dependency selection, software installation, implementation planning, reproduction work, integration, and product-level testing. Also trigger when an engineering failure must be localized through its real information flow. Do not trigger for explanation-only questions with no engineering decision.
---

# Engineering Execution Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When installing anything, prioritize the D, E, and F drives
- If there is an engineering problem involving code, first search StackOverflow for the relevant issue and then solve it; do not keep your head down and modify it on your own.
- Do not preserve backward compatibility. Delete obsolete parts directly; do not add compatibility layers, write migrations, or retain fallbacks.
- Choose an implementation that satisfies the current requirements. Do not introduce abstractions preemptively or add unnecessary configuration layers.
- Systems grow in layers. First get a minimal end-to-end version working, then add things on top of it. Never dismantle something that works for the sake of unfinished complexity.
- Keep components modular and separate concerns.
- Prefer mature, maintained libraries. Do not rewrite things yourself without a clear reason.
- First investigate what the project's existing dependencies can do, then consider adding a new package or writing it yourself. Do not begin by assuming the library lacks the needed capability.
- Make architectural decisions for the long term. Do not accept temporary solutions of “do this for now and replace it later.”
- First examine how mature products solve the same problem and use proven patterns; do not invent from scratch.
- Locate the first divergence: inspect the information flow across the input, intermediate processing state, output, and actual consumer to find the first point where it diverges from the objective.
- Change course according to the failure mechanism: distinguish among insufficient information, interface errors, semantic errors, evaluation errors, environment problems, and methodological errors; do not merely repeat retries or add patches for different failures.
