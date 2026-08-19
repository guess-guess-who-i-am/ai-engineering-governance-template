---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting an acceptance gate for a goal, do not make up the number or measurement standard. Examine what numbers are reasonable, how others set them according to the current task and data, and whether the value I set has a theoretical basis; it must be reasonable.
- Every time we evaluate, consider whether our evaluation standard is actually correct or merely arbitrary. Is there a basis? Our evaluation standard must be correct and supported by authoritative evidence, and the measurement must also be correct. What we evaluate is the strict final standard.
- Testing must be rigorous. For project tests, follow actual user operations, clicking step by step, and verify whether the feature truly works and is effective, rather than merely being clickable.
- Revise standards when there is no scientific research, then reassess how to proceed. There must be scientific support, especially for thresholds; do not make them up.
- Use modification-based testing to verify understanding: do not look only at paraphrase or surface similarity; test whether key behavior still holds by changing inputs, replacing components, or changing conditions.
- **When creating a gate, add large-model evaluation for aspects that cannot be measured numerically, such as taste and intent. These gates must always be included. You can use api_key, obtaining the corresponding base_url and api_key from the user's configured codex location. After creating the gate, calibrate it by first testing whether it meets the user's testing requirements; the gate must not be biased.**
- For any task, evidence must consist of a real entry point, real input, real output, and traceable artifacts; a plan, file existence, or status=ok does not constitute completion.
- When results are abnormally beautiful, abnormally poor, or abnormally uniform, audit first; do not initially believe or reject them.
- For every conclusion, say directly when you do not know. To ensure a conclusion is correct, authoritative support and ground truth are required.
- Applicable boundary: when obtainable ground truth exists, comparison validation must be performed; when ground truth does not exist, state this explicitly, distinguish known facts, evidence-supported inferences, assumptions, and unknowns, and explain the proxy standard used and its limitations.
