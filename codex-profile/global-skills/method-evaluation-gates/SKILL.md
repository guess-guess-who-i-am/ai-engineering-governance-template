---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting a corresponding acceptance gate for a goal, do not make up the number or measurement standard. Look at what numbers are reasonable, how others set this number based on the current task and data, and whether there is a theoretical basis for setting this value. It must be reasonable.
- Every time you evaluate, consider whether our evaluation standard is actually correct or merely arbitrary. Our evaluation standard must be correct, must have authoritative support that genuinely supports our evaluation metric, and the measurement must also be correct. What we evaluate is the strict final standard.
- Testing must be rigorous. If it is project testing, follow actual user operations, clicking step by step, and determine whether the feature truly works and is genuinely effective, rather than merely being clickable.
- Change standards for anything without scientific research. Then review them again and see how to continue; there must be scientific support, especially for thresholds, which cannot be made up arbitrarily.
- Use input-variation testing to verify understanding: do not look only at paraphrases or surface similarity; verify whether key behavior still holds by changing inputs, replacing components, or changing conditions.
- **When creating a gate, add large-model evaluation for parts that cannot be measured numerically, such as taste and intent. These gates must be added; you can use api_key and obtain the corresponding base_url and api_key from the user's configured Codex location for configuration. After creating the gate, calibrate it: first test whether this gate meets the user's testing requirements; the gate must not be biased.**
- For any task, evidence must consist of a real entry point, real input, real output, and traceable artifacts; plans, file existence, or status=ok do not constitute completion.
- When results are unusually beautiful, unusually poor, or unusually uniform, audit first; do not first believe them or first reject them.
- For every conclusion, directly say “I don't know” when you do not know. To ensure that a conclusion is correct, there must be authoritative support and ground truth.
- Applicable boundary: when obtainable ground truth exists, comparison verification must be performed; when ground truth does not exist, this must be explicitly stated, and known facts, evidence-supported inferences, assumptions, and unknowns must be distinguished, while also stating the proxy standard used and its limitations.
