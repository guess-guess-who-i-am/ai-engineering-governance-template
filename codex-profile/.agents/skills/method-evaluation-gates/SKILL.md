---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting an acceptance gate for an objective, its number and measurement standard must not be made up. Examine what kinds of numbers are reasonable, how others set these numbers according to the current task and data, and whether the data I set has a theoretical basis. It must be reasonable.
- During every evaluation, consider whether our evaluation standard is actually correct or merely arbitrary. Is there a basis for it? Our evaluation standard must be correct and must have authoritative support that genuinely supports our evaluation metrics; the measurement must also be correct. What we need to evaluate is the strict final standard.
- Testing must be rigorous. For project testing, operate step by step as an actual user would, and examine whether the feature genuinely works and has a real effect, rather than merely being clickable.
- Change every standard that lacks scientific research support. Then reassess how to continue moving forward. There must be scientific support, especially for thresholds; do not make them up yourself.
- Test understanding through modification: do not look only at restatements or superficial similarity; change the input, replace components, or alter conditions to test whether the key behavior still holds.
- **When creating a gate, add large-model evaluation for parts that cannot be measured numerically, such as taste, intent, and so on. Gates for all of these must be included. You may use api_key and obtain the corresponding base_url and api_key from the user's Codex configuration to configure them. After creating the gate, calibrate it by first testing whether the gate satisfies the user's testing requirements; the gate must not be biased.**
- For any task, evidence must consist of a real entry point, real input, real output, and traceable artifacts; a plan, file existence, or status=ok does not constitute completion.
- When results are exceptionally good, exceptionally poor, or exceptionally uniform, audit them first; do not believe or reject them first.
- For every conclusion, if you do not know, say directly that you do not know. To ensure that the conclusion is correct, it must have authoritative support and ground truth.
- Applicability boundary: when obtainable ground truth exists, comparative validation must be performed; when ground truth does not exist, this must be clearly stated, known facts, evidence-supported inferences, assumptions, and unknowns must be distinguished, and the proxy standard used and its limitations must be explained.
