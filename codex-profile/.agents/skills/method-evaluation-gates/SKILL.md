---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting a corresponding acceptance gate for an objective, do not make up the number or measurement criterion. Instead, examine what kinds of numbers are reasonable, how others' work sets this number according to the current task and data, and whether the data I set has a theoretical basis. It must be reasonable.
- During every evaluation, consider whether our evaluation criteria are actually correct or whether the evaluation is arbitrary. Is there a basis for them? Our evaluation criteria must be correct and must have authoritative grounds that genuinely support our evaluation metrics; the measurements must also be correct. What we must evaluate is the strict final standard.
- Testing must be rigorous. For project testing, operate step by step as a real user would, and examine whether the feature is genuinely usable and genuinely effective, rather than merely clickable.
- Change every standard that lacks scientific research. Then reassess how to continue making progress; it must have scientific support, especially thresholds, which must not be made up.
- Test understanding through modification: do not look only at restatements or superficial similarity; test whether the key behavior still holds by changing the input, replacing components, or changing conditions.
- **When creating a gate, include large-model evaluation for parts that cannot be measured numerically, such as taste and intent; gates for all of these must be included. You may use api_key and obtain the corresponding base_url and api_key from the user's Codex configuration for setup. After creating the gate, calibrate it by first testing whether the gate satisfies the user's testing requirements; the gate must not be biased.**
