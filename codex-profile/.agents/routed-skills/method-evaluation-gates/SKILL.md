---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting an acceptance gate for a target, the number and measurement standard must not be pulled out of thin air. Instead, examine what kind of number is reasonable, how others set this number based on the current task and data, and whether there is a theoretical basis for setting it this way. It must be reasonable.
- Every time we conduct an evaluation, we must consider whether our evaluation standards are actually correct or whether we are evaluating arbitrarily. Is there a basis? Our evaluation standards must be correct and must have authoritative evidence that genuinely supports our evaluation metrics; the measurements must also be correct. What we need to evaluate is the strict final standard.
- Testing must be rigorous. If it is project testing, follow actual user operations, clicking step by step, and determine whether the feature truly works and is genuinely effective, rather than merely being clickable.
- Revise all standards that lack scientific research. Then re-examine how to continue advancing. There must be scientific support, especially for thresholds; they must not be invented arbitrarily.
- Use modified-input verification to test understanding: do not look only at paraphrases or superficial similarity; test whether the key behavior still holds by changing the input, replacing components, or altering conditions.
- **When doing a gate, add evaluation by a large language model to assess aspects that cannot be measured numerically, such as taste and intent. These must all be included as gates. You can use api_key, obtaining the corresponding base_url and api_key from the user's configured Codex location for configuration. After doing the gate, perform calibration: first test whether the gate meets the user's testing requirements; the gate must not be biased.**
- For any task, evidence must consist of a real entry point, real inputs, real outputs, and traceable artifacts; a plan, file existence, or status=ok does not constitute completion.
- When results are exceptionally beautiful, exceptionally poor, or exceptionally neat, audit first; do not believe or deny them first.
- For every conclusion, directly say what you do not know. Ensuring that this conclusion is correct requires authoritative support and ground truth.
- Applicability boundary: when ground truth is obtainable, comparison verification must be performed; when ground truth does not exist, this must be explicitly stated, and known facts, evidence-supported inferences, assumptions, and unknowns must be distinguished, while also stating the proxy criteria used and their limitations.
- Use the verification budget according to the type of change: when only governance documents or Skills are modified, run `scripts/validate-governance.ps1` and `scripts/validate-skills.ps1`; when scripts are modified, run representative success cases and failure cases for the modified scripts; when UI is modified, check narrow and wide viewport, keyboard operation, accessibility, and qualitative quality gates; when the contract is modified, provide producer, consumer, failure semantics, and end-to-end Flow evidence; when reaching the release boundary, run `scripts/check.ps1`; if the relevant inputs have not changed, do not rerun the complete gate.
