---
name: method-evaluation-gates
description: Use when defining acceptance criteria, thresholds, metrics, verification strategy, test coverage, qualitative taste or intent, LLM-based gates, benchmark comparisons, or whether work can be claimed complete. Do not trigger merely because a routine implementation has an obvious narrow test.
---

# Evaluation Gates Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When setting a corresponding acceptance gate for a goal, the number and measurement criteria must not be chosen arbitrarily. Instead, examine what numbers are actually reasonable, how others set these numbers based on the current task and data, and whether the value I have set has a theoretical basis. It must be reasonable.
- At every evaluation, consider whether our evaluation criteria are actually correct or whether we are evaluating arbitrarily. Is there a basis? Our evaluation criteria must be correct, and they must have an authoritative basis that genuinely supports our evaluation metrics. The measurements must also be correct. We must evaluate against the strict final standard.
- Testing must be rigorous. When testing a project, follow operations similar to those a user would actually perform, clicking step by step, and check whether the feature is genuinely usable and actually effective, rather than merely clickable.
- Revise all standards that lack scientific research support. Then reassess how to continue making progress. There must be scientific support, especially for thresholds; they must not be chosen arbitrarily.
- Test understanding through modifications: do not rely solely on restatement or superficial similarity; test whether key behaviors still hold by changing inputs, replacing components, or changing conditions.
- **When creating a gate, include evaluation by a large language model to assess aspects that cannot be measured numerically, such as taste and intent. Gates for all these aspects must be included. You can use api_key, obtaining the corresponding base_url and api_key from the user's codex configuration to configure it. After creating the gate, calibrate it by first testing whether it meets the user's testing requirements. The gate must not be biased.**
- For any task, evidence must consist of a real entry point, real inputs, real outputs, and traceable artifacts; a plan, the existence of files, or status=ok does not constitute completion.
- Whenever you are about to complete a task, check whether the result meets requirements from the user's or reviewer's perspective; if it does not, first perform root cause analysis, then search to address evidence gaps that would change the conclusion, implement improvements, and revalidate until the strict final standards are met, or explicitly report the blockers that remain.
- When results are unusually good, unusually poor, or unusually orderly, audit first; neither believe nor reject them first.
- For every conclusion, directly state what you do not know. Ensuring that the conclusion is correct requires authoritative support and ground truth.
- Applicability boundaries: when obtainable ground truth exists, validation against it is mandatory; when ground truth does not exist, this must be explicitly stated, and known facts, evidence-supported inferences, assumptions, and unknowns must be distinguished, while also explaining the proxy criteria used and their limitations.
- Apply the validation budget according to the type of change: when modifying only governance documents or Skills, run `scripts/validate-governance.ps1` and `scripts/validate-skills.ps1`; when modifying scripts, run representative success and failure cases for the modified scripts; when modifying the UI, check narrow and wide viewports, keyboard operation, accessibility, and qualitative quality gates; when modifying a contract, provide evidence for producers, consumers, failure semantics, and the end-to-end Flow; when reaching a release boundary, run `scripts/check.ps1`, and do not rerun the full gates if the relevant inputs have not changed.
