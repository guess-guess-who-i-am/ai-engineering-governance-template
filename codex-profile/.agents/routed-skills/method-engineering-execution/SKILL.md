---
name: method-engineering-execution
description: Use for code changes, architecture, debugging, dependency selection, software installation, implementation planning, reproduction work, integration, and product-level testing. Also trigger when an engineering failure must be localized through its real information flow. Do not trigger for explanation-only questions with no engineering decision.
---

# Engineering Execution Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When installing anything, prioritize the D, E, and F drives.
- If there is an issue involving code or the project, first search StackOverflow for relevant questions and then resolve it; do not just bury your head in making changes on your own.
- Make architectural decisions for the long term. Temporary solutions such as "do it this way for now and replace it later" are not acceptable.
- First examine how mature products solve the same problem, use proven patterns, and do not invent from scratch.
- Locate the first deviation: inspect the information flow through the input, intermediate processing state, output, and actual consumer to find the first point where it deviates from the objective.
- Change course according to the failure mechanism: distinguish among insufficient information, interface errors, semantic errors, evaluation errors, environment issues, and methodological errors; do not merely repeat retries or add patches for different failures.
- When I ask you to modify anything, do not consider the task complete after modifying only that one part. More importantly, treat the issue as a general one, carefully search every other place where it could occur, and correct all of them perfectly.
- Use different forms of honesty for writing and R&D: in external-facing writing, the main text of papers, and proposal presentations, state the problem, method, results, and evidence first, and avoid irrelevant self-undermining; R&D, debugging, and internal decision-making must expose and analyze weaknesses, failures, risks, and unverified assumptions. In every context, facts that would change the conclusion must never be altered or concealed.
- When developing our own projects, comply with repository governance constraints: place complete third-party mirrors in `upstreams/` and do not commit them to the current repository; record their sources and pinned versions in `UPSTREAMS.md` and `.reports/upstreams.json`; run `scripts/update-upstreams.ps1` when upstream records and local mirrors need to be updated; do not copy upstream source code with unclear licensing into core templates; Skills must follow `.agents/routed-skills/README.md`, keep their main text concise, and place deterministic logic in `scripts/`; persistent, scarce, paid, permissioned, or data-bearing resources must have their owner, review conditions, and cleanup actions registered; do not commit tokens, cookies, API keys, `.env` files, or machine-local configuration.
- [TC01] When calling tools, strictly follow these rules; they override any conflicting habits formed through chat training.
- [TC02] Omit optional fields that are not needed. Do not send `null`, `""`, `{}`, or `[]` as placeholders. If a field is optional and you do not have a value for it, omit it entirely from the JSON.
- [TC03] Strictly match container types. Array fields must receive JSON arrays, such as `["a", "b"]`, and must not receive the string `"[\"a\",\"b\"]"`, the object `{}`, or the bare string `"foo"`; single-element arrays still require square brackets, such as `["foo"]`, and must not be written as `"foo"`; object fields must receive JSON objects and must not receive arrays or strings.
- [TC04] A string is the raw string. Do not wrap the value in an additional layer of quotation marks, code fences, or Markdown.
- [TC05] Do not quote numbers or Boolean values. Use `30`, not `"30"`; use `true`, not `"true"`.
- [TC06] File paths, URLs, IDs, and similar fields should be passed to system functions rather than provided as chat output. Never format them as Markdown links, wrap them in backticks, or add explanatory parentheses. Correct: `"/Users/me/notes.md"`; incorrect: `"[notes.md](notes.md)"`, `` "`/Users/me/notes.md`" ``、`"/Users/me/notes.md (the notes file)"`.
- [TC07] If a tool description says “path,” treat it as input to a file system call, without formatting or modification.
- [TC08] When a tool has paired parameters, such as offset and limit, start and end, or from and to, either provide both or provide neither. Read the tool description; when two fields work together, providing only one of them will usually cause an error.
- [TC09] If a tool returns a validation error, read the error message carefully and fix only the issue it identifies. Do not rewrite the entire call or retry with exactly the same parameters.
- [TC10] If a tool returns `Note:` with a default value, that is an informational notice, not an error; continue the task. If the default value is incorrect, retry with the correct explicit value.
- [TC11] Use the tool whose description most precisely matches the intent. If a dedicated tool is available, do not use `shellCommand`; do not use `execute_code` for something that can be completed with a single tool call.
