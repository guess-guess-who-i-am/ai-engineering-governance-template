---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting a corresponding acceptance gate for an objective, the number and measurement standard must not be chosen arbitrarily. Examine what numbers are actually reasonable, how others set them based on the current task and data, and whether the value I set has a theoretical basis. It must be reasonable.
- At every evaluation, consider whether our evaluation criteria are actually correct or whether we are evaluating arbitrarily. Is there a basis? Our evaluation criteria must be correct and must have authoritative support that truly substantiates our evaluation metrics; the measurements must also be correct. What we evaluate must be the strict final standard.
- Be rigorous when testing. For project testing, follow something like the user's actual operations, clicking step by step, and examine whether the feature is truly usable and effective, rather than merely clickable.
- Revise all standards that lack scientific research support. Then reassess how to continue making progress; there must be scientific support, especially for thresholds, which must not be chosen arbitrarily.
- Test understanding through modifications: do not look only at restatements or superficial similarity; change inputs, replace components, or alter conditions to test whether key behaviors still hold.
- **When creating gates, include large-model evaluation of aspects that cannot be measured numerically, such as taste, intent, and so on; gates for all of these must be included. You can use api_key, taking the corresponding base_url and api_key from the user's Codex configuration to configure it. After creating a gate, calibrate it: first test whether the gate meets the user's testing requirements; the gate must not be skewed.**
- For any task, evidence must consist of a real entry point, real inputs, real outputs, and traceable artifacts; a plan, file existence, or status=ok does not constitute completion.
- When results are unusually good, unusually bad, or unusually neat, audit first; do not first believe or reject them.
- For every conclusion, if you do not know, say directly that you do not know. To ensure the conclusion is correct, there must be authoritative support and ground truth.
- Applicability boundaries: when obtainable ground truth exists, comparative validation is mandatory; when ground truth does not exist, explicitly state this and distinguish known facts, evidence-supported inferences, assumptions, and unknowns, while also explaining the proxy criteria used and their limitations.
