---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting a corresponding acceptance gate for an objective, do not invent the number or measurement standard based on your own judgment. Examine what numbers are reasonable, how others set them according to the current task and data, and whether the value I set has a theoretical basis. It must be reasonable.
- During every evaluation, consider whether our evaluation criteria are actually correct or arbitrarily chosen, and whether they have a basis. Our evaluation criteria must be correct and must have authoritative evidence that genuinely supports our evaluation metrics; the measurements must also be correct. What we evaluate must be the strict final standard.
- Testing must be rigorous. For project testing, operate it step by step as an actual user would, clicking through it and checking whether the feature truly works and truly has an effect, rather than merely whether it can be clicked.
- Change every standard that lacks scientific research support. Then reassess how to continue making progress. There must be scientific support, especially for thresholds; do not invent them based on your own judgment.
- Test understanding through modifications: do not look only at restatements or superficial similarity; change the input, replace components, or alter conditions to test whether the key behavior still holds.
- **When creating a gate, add large-model evaluation for the parts that cannot be measured numerically, such as taste, intent, and so on. Gates for all of these must be added. You may use api_key and obtain the corresponding base_url and api_key from the user's configured Codex location for configuration. After creating the gate, calibrate it by first testing whether the gate satisfies the user's testing requirements; the gate must not be biased.**
- For any task, evidence must consist of a real entry point, real input, real output, and traceable artifacts; a plan, file existence, or status=ok does not constitute completion.
- When results are unusually good, unusually poor, or unusually uniform, audit them first; neither believe nor reject them immediately.
- For every conclusion, if you do not know, say directly that you do not know. Ensuring that the conclusion is correct requires authoritative support and ground truth.
- Applicability boundary: when obtainable ground truth exists, comparative validation must be performed; when no ground truth exists, explicitly state this, distinguish known facts, evidence-supported inferences, assumptions, and unknowns, and explain the proxy criteria used and their limitations.
