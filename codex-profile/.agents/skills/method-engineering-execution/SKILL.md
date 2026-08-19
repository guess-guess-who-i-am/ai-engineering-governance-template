---
name: method-engineering-execution
description: Use for code changes, architecture, debugging, dependency selection, software installation, implementation planning, reproduction work, integration, and product-level testing. Also trigger when an engineering failure must be localized through its real information flow. Do not trigger for explanation-only questions with no engineering decision.
---

# Engineering Execution Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When installing anything, prioritize drives D, E, and F
- If there is an engineering problem involving code, first search Stack Overflow for the relevant issue and then solve it; do not make changes in isolation.
- Do not retain backward compatibility. Delete obsolete things directly; do not add compatibility layers, write migrations, or leave fallbacks.
- Choose an implementation that satisfies the current requirements. Do not add anticipatory abstractions or unnecessary configuration layers.
- The system has long layering. First get a minimal end-to-end version working, then add things on top. Never dismantle something that works for the sake of unfinished complexity.
- Keep components modular and separate concerns.
- Prefer mature, maintained libraries. Do not rewrite them yourself without a clear reason.
- First examine what the project's existing dependencies can do, then consider adding a new package or writing it yourself. Do not start by assuming the library lacks it.
- Make architecture decisions for the long term. Do not accept temporary solutions of “use this for now and replace it later.”
- First examine how mature products solve the same problem. Use proven patterns; do not invent from scratch.
- Locate the first divergence: inspect the information flow through the input, intermediate processing state, output, and actual consumer to find the first point where it diverges from the objective.
- Change course according to the failure mechanism: distinguish insufficient information, interface errors, semantic errors, evaluation errors, environment problems, and methodological errors; do not respond to different failures merely by retrying or adding patches repeatedly.
- When I ask you to modify anything, do not consider the task complete after modifying only that one part. More importantly, treat the issue as a general problem, carefully search every other place where it might occur, and correct all of them perfectly.
- Writing and R&D use different forms of honesty: external writing, the main paper text, and proposal reports should first state the problem, method, results, and evidence, avoiding irrelevant self-weakening; R&D, debugging, and internal decision-making must expose and analyze disadvantages, failures, risks, and unverified assumptions. In every context, facts that would change the conclusion must not be altered or concealed.
