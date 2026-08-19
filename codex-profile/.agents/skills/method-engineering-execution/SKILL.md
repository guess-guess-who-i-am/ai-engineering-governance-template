---
name: method-engineering-execution
description: Use for code changes, architecture, debugging, dependency selection, software installation, implementation planning, reproduction work, integration, and product-level testing. Also trigger when an engineering failure must be localized through its real information flow. Do not trigger for explanation-only questions with no engineering decision.
---

# Engineering Execution Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When installing anything, prioritize drives D, E, and F.
- If there is an engineering problem in the code or project, first search StackOverflow for related problems and then solve it; do not blindly modify things on your own.
- Do not preserve backward compatibility. Delete obsolete things directly; do not add compatibility layers, write migrations, or leave fallbacks.
- Choose an implementation that satisfies the current requirements. Do not create preventive abstractions or unnecessary configuration layers.
- Build the system in layers. First get a minimal end-to-end version running, then add more. Never dismantle something that runs merely because of unfinished complexity.
- Keep components modular and focus on separation of concerns.
- Prefer mature, maintained libraries. Do not rewrite things yourself without a clear reason.
- First inspect what existing dependencies in the project can do, then consider adding a new package or writing it yourself. Do not assume at the outset that the library has nothing suitable.
- Make architectural decisions for the long term. Do not accept temporary solutions of “do it this way for now and switch later.”
- First see how mature products solve the same problem and use validated patterns; do not invent from scratch.
- Locate the first deviation: inspect the information flow through inputs, intermediate processing states, outputs, and actual consumers to find where it first deviates from the objective.
- Change the route according to the failure mechanism: distinguish insufficient information, interface errors, semantic errors, evaluation errors, environmental problems, and methodological errors; do not merely repeat retries or add patches for different failures.
- Writing and R&D use different forms of honesty: in external writing, the paper body, and proposal presentations, first state the problem, method, results, and evidence, avoiding irrelevant self-undermining; R&D, debugging, and internal decisions must expose and analyze disadvantages, failures, risks, and unverified assumptions. In every setting, do not alter or conceal facts that would change the conclusion.
