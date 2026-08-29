---
name: method-engineering-execution
description: Use for code changes, architecture, debugging, dependency selection, software installation, implementation planning, reproduction work, integration, and product-level testing. Also trigger when an engineering failure must be localized through its real information flow. Do not trigger for explanation-only questions with no engineering decision.
---

# Engineering Execution Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When installing anything, prioritize the D, E, and F drives
- If there are project-level issues around the code, first search StackOverflow for relevant issues and then solve them; do not blindly modify things on your own.
- Make architectural decisions for the long term. Temporary solutions of "do it this way for now and change it later" are not accepted.
- First see how mature products solve the same problem, use validated patterns, and do not invent things from scratch.
- Locate the first divergence: inspect the information flow along the input, intermediate processing states, output, and actual consumers, and find the first point where it diverges from the target.
- Change the route based on the failure mechanism: distinguish insufficient information, interface errors, semantic errors, evaluation errors, environmental problems, and methodological errors; do not merely retry repeatedly or add patches for different failures.
- Whenever I ask you to modify anything, do not merely modify this one part and count it as complete; instead, treat the issue as a common problem, carefully search all other places where this problem could possibly occur, and correct them all perfectly.
- Writing and R&D adopt different forms of honesty: for external writing, the body of a paper, and solution presentations, first state the problem, method, results, and evidence, avoiding irrelevant self-undermining; R&D, debugging, and internal decisions must expose and analyze disadvantages, failures, risks, and unverified assumptions. In either situation, do not alter or conceal facts that would change the conclusion.
- When developing our own projects, comply with repository governance constraints: put complete third-party mirrors in `upstreams/` and do not commit them to the current repository, record sources and pinned versions in `UPSTREAMS.md` and `.reports/upstreams.json`, and run `scripts/update-upstreams.ps1` when updating upstream records and local mirrors; do not copy upstream source with unclear licensing into core templates; Skills follow `.agents/routed-skills/README.md`, keep the body concise, and put deterministic logic in `scripts/`; persistent, scarce, paid, privileged, or data-bearing resources must register an owner, review conditions, and cleanup actions; do not commit tokens, cookies, API keys, `.env` files, or machine-local configuration.
- [TC01] When calling tools, strictly follow these rules; they take precedence over any conflicting habits formed through chat training.
- [TC02] Omit unnecessary optional fields. Do not send `null`, `""`, `{}` or `[]` as placeholders. If a field is optional and you have no value, omit it entirely from the JSON.
- [TC03] Strictly match container types. Array fields must receive JSON arrays, for example `["a", "b"]`, and cannot receive the string `"[\"a\",\"b\"]"`, object `{}`, or bare string `"foo"`; single-element arrays still require square brackets, for example `["foo"]`, and cannot be written as `"foo"`; object fields must receive JSON objects and cannot receive arrays or strings.
- [TC04] A string is simply a raw string. Do not additionally wrap the value in another layer of quotation marks, code fences, or Markdown.
- [TC05] Numbers and boolean values are not quoted. Use `30`, rather than `"30"`; use `true`, rather than `"true"`.
- [TC06] File paths, URLs, IDs, and similar fields should be passed to system functions rather than output as chat. Never format them as Markdown links, wrap them in backticks, or add explanatory parentheses. Correct: `"/Users/me/notes.md"`; Incorrect: `"[notes.md](notes.md)"`, `` "`/Users/me/notes.md`" ``、`"/Users/me/notes.md (the notes file)"`.
- [TC07] If the tool description says “path”, treat it as input to a filesystem call, without formatting or modification.
- [TC08] When a tool has paired parameters, such as offset and limit, start and end, from and to, either provide both or provide neither. Read the tool description; when the two fields work together, providing only half usually causes an error.
- [TC09] If a tool returns a validation error, carefully read the error message and fix only the issue it identifies. Do not rewrite the entire call, and do not retry with exactly the same parameters.
- [TC10] If a tool returns `Note:` with a default value, that is informational, not an error; continue the task. If the default value is incorrect, retry with the correct explicit value.
- [TC11] Use the tool whose instructions most precisely match the intent. If there is a specialized tool, do not use `shellCommand`; do not use `execute_code` for something that can be completed with one tool call.
