---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting a corresponding acceptance gate for an objective, do not invent the number or measurement standard based on intuition. Examine what numbers are reasonable, how others set this number based on the current task and data, and whether the value I set has a theoretical basis. It must be reasonable.
- During every evaluation, consider whether our evaluation criteria are actually correct or merely arbitrary. Is there supporting evidence? Our evaluation criteria must be correct and must have authoritative evidence that genuinely supports our evaluation metrics; the measurements must also be correct. What we must evaluate is the strict final standard.
- Testing must be rigorous. For project testing, operate it step by step in a manner similar to an actual user and determine whether the feature truly works and has a real effect, rather than merely whether it can be clicked.
- Change any standards that lack scientific research support. Then reassess how to continue making progress. There must be scientific support, especially for thresholds; do not invent them based on intuition.
- Test understanding through modification: do not look only at restatement or surface similarity; test whether the key behavior still holds by changing the input, replacing components, or changing conditions.
- **When creating a gate, add large-model evaluation for the parts that cannot be measured numerically, such as taste, intent, and so on. Gates for all of these must be added. You may use api_key and obtain the corresponding base_url and api_key from the user's codex configuration to configure it. After creating the gate, calibrate it by first testing whether the gate satisfies the user's testing requirements; the gate must not be biased.**
- For any task, evidence must consist of a real entry point, real input, real output, and traceable artifacts; a plan, the existence of files, or status=ok does not constitute completion.
- When results are exceptionally good, exceptionally poor, or exceptionally uniform, audit them first; do not immediately believe or reject them.
- For every conclusion, if you do not know, say directly that you do not know. To ensure that a conclusion is correct, it must have authoritative support and ground truth.
- Applicability boundary: when obtainable ground truth exists, comparative validation must be performed; when ground truth does not exist, this must be stated explicitly, and known facts, evidence-supported inferences, assumptions, and unknowns must be distinguished, while also explaining the proxy standards used and their limitations.
