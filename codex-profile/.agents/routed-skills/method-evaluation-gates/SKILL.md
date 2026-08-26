---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting an acceptance gate for an objective, this figure and the measurement criteria must not be invented arbitrarily; instead, examine what figures are actually reasonable, how others set this figure based on the current task and data, and whether the data I set has a theoretical basis. It must be reasonable.
- During every evaluation, consider whether our evaluation criteria are actually correct or whether the evaluation is arbitrary. Is there a basis for them? Our evaluation criteria must be correct and must have an authoritative basis that can genuinely support our evaluation metrics, and the measurements must also be correct. What we must evaluate against is the strict final standard.
- Testing must be rigorous. If it is project testing, follow operations similar to those of an actual user, clicking through step by step, and determine whether the feature truly works and truly produces results, rather than merely being clickable.
- Change the standards for anything that lacks scientific research. Then re-examine it and determine how to continue moving forward. There must be scientific support, especially for thresholds; they must not be invented arbitrarily.
- Test understanding through modifications: do not look only at restatements or superficial similarities; test whether the key behavior still holds by changing the input, replacing components, or altering conditions.
- **When creating a gate, include an evaluation by a large model for aspects that cannot be measured numerically, such as taste, intent, and so on. Gates for all of these must be included. You may use api_key and obtain the corresponding base_url and api_key from the user's Codex configuration for setup. After creating the gate, calibrate it by first testing whether the gate meets the user's testing requirements; the gate must not be biased.**
- For any task, evidence must consist of a real entry point, real inputs, real outputs, and traceable artifacts; a plan, the existence of files, or status=ok does not constitute completion.
- When results are unusually good-looking, unusually poor, or unusually uniform, audit them first; neither believe nor reject them first.
- For every conclusion, if you do not know, say directly that you do not know. Guaranteeing that the conclusion is correct requires authoritative support and ground truth.
- Scope of applicability: when obtainable ground truth exists, comparative validation must be performed; when ground truth does not exist, this must be stated explicitly, and known facts, evidence-supported inferences, assumptions, and unknowns must be distinguished, while also stating the proxy criteria used and their limitations.
- Allocate the validation budget according to the type of change: when only governance documents or a Skill are modified, run `scripts/validate-governance.ps1` and `scripts/validate-skills.ps1`; when a script is modified, run representative success and failure cases for the modified script; when the UI is modified, check narrow- and wide-screen viewports, keyboard operation, accessibility, and the qualitative quality gate; when a contract is modified, provide evidence for the producer, consumer, failure semantics, and end-to-end Flow; when the release boundary is reached, run `scripts/check.ps1`, and do not rerun the full gate if the relevant inputs have not changed.
