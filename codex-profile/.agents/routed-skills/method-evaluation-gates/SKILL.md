---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting an acceptance gate for an objective, neither the number nor the measurement criteria may be invented arbitrarily. Instead, examine what numbers are actually reasonable, how others set such numbers based on the current task and data, and whether the value I set has a theoretical basis. It must be reasonable.
- For every evaluation, consider whether our evaluation criteria are actually correct or whether the evaluation is arbitrary. Is there supporting evidence? Our evaluation criteria must be correct and must have an authoritative basis that can genuinely support our evaluation metrics, and the measurements must also be correct. What we must evaluate against is the strict final standard.
- Testing must be rigorous. If testing a project, follow operations similar to those of an actual user, clicking through step by step, and determine whether the feature truly works and actually produces results, rather than merely being clickable.
- Revise every standard that lacks scientific research. Then reassess the situation and determine how to continue moving forward. There must be scientific support, especially for thresholds; they must not be invented arbitrarily.
- Use modification-based testing to verify understanding: do not rely only on restatement or superficial similarity; test whether the key behavior still holds by changing the input, replacing components, or altering conditions.
- **When creating a gate, include an evaluation by a large language model for aspects that cannot be measured numerically, such as taste and intent. Gates for all of these must be included. The api_key can be used, with the corresponding base_url and api_key obtained from the user's Codex configuration. After creating a gate, calibrate it by first testing whether the gate satisfies the user's testing requirements; the gate must not be biased.**
- For any task, evidence must consist of a real entry point, real inputs, real outputs, and traceable artifacts; a plan, the existence of files, or status=ok does not constitute completion.
- When results are unusually good, unusually bad, or unusually neat, audit first; do not believe or reject them first.
- For every conclusion, say plainly when you do not know. Ensuring that a conclusion is correct requires authoritative support and ground truth.
- Applicability boundary: when ground truth is available, comparison validation must be performed; when ground truth does not exist, state this explicitly, distinguish known facts, evidence-supported inferences, assumptions, and unknowns, and explain the proxy criteria used and their limitations.
- Use the verification budget according to the change type: when only governance documents or Skill are modified, run `scripts/validate-governance.ps1` and `scripts/validate-skills.ps1`; when scripts are modified, run representative success and failure cases for the modified scripts; when UI is modified, check narrow-screen and wide-screen viewports, keyboard operation, accessibility, and qualitative quality gates; when contract is modified, provide producer, consumer, failure semantics, and end-to-end Flow evidence; when the release boundary is reached, run `scripts/check.ps1`; if the relevant inputs have not changed, do not rerun the full gate.
