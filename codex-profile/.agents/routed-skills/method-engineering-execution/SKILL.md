---
name: method-engineering-execution
description: Use for code changes, architecture, debugging, dependency selection, software installation, implementation planning, reproduction work, integration, and product-level testing. Also trigger when an engineering failure must be localized through its real information flow. Do not trigger for explanation-only questions with no engineering decision.
---

# Engineering Execution Method

## Routing instruction

Apply every rule below when this Skill is selected. These are the user's original rules translated into English, not a rewritten summary.

## User's original wording — English translation

- When installing anything, prioritize drives D, E, and F.
- For code or engineering problems, prioritize looking up related questions on StackOverflow before resolving them; do not blindly make changes on your own.
- Make architectural decisions for the long term. Temporary solutions such as "do this for now and replace it later" are not acceptable.
- First examine how mature products solve the same problem, use proven patterns, and do not invent from scratch.
- Locate the first deviation: inspect the information flow through inputs, intermediate processing states, outputs, and actual consumers to find the first point that deviates from the objective.
- Change course according to the failure mechanism: distinguish insufficient information, interface errors, semantic errors, evaluation errors, environment problems, and method errors; do not merely repeat retries or add patches for different failures.
- When I ask you to modify anything, do not consider the task complete after modifying only that one part; instead, treat the issue as a common problem, carefully search all other places where it might occur, and correct all of them perfectly.
- Apply different forms of honesty to writing and development: external writing, the main text of papers, and proposal presentations should first state the problem, methods, results, and evidence, avoiding irrelevant self-undermining; development, debugging, and internal decision-making must expose and analyze weaknesses, failures, risks, and unverified assumptions. In either setting, facts that would change the conclusion must not be falsified or concealed.
- When developing our own projects, comply with repository governance constraints: place complete third-party mirrors in `upstreams/` and do not commit them to the current repository, record their sources and pinned versions in `UPSTREAMS.md` and `.reports/upstreams.json`, and run `scripts/update-upstreams.ps1` when upstream records and local mirrors need updating; do not copy upstream source code with unclear licensing into core templates; Skills must follow `.agents/routed-skills/README.md`, keep the main text concise, and place deterministic logic in `scripts/`; resources that are persistent, scarce, paid, permissioned, or hold data must have their owners, review conditions, and cleanup actions registered; do not commit tokens, cookies, API keys, `.env` files, or machine-local configuration.
- [TC01] When calling tools, strictly follow these rules; they override any conflicting habits formed through chat training.
- [TC02] Omit unnecessary optional fields. Do not send `null`, `""`, `{}`, or `[]` as placeholders. If a field is optional and you have no value, omit it entirely from the JSON.
- [TC03] Strictly match container types. Array fields must receive JSON arrays, such as `["a", "b"]`, not strings `"[\"a\",\"b\"]"`, objects `{}`, or bare strings `"foo"`; single-element arrays still require square brackets, such as `["foo"]`, and must not be written as `"foo"`; object fields must receive JSON objects, not arrays or strings.
- [TC04] Strings are raw strings. Do not wrap values in an additional layer of quotation marks, code fences, or Markdown.
- [TC05] Do not quote numbers or Boolean values. Use `30`, not `"30"`; use `true`, not `"true"`.
- [TC06] File paths, URLs, IDs, and similar fields should be passed to system functions, not output in chat. Never format them as Markdown links, wrap them in backticks, or add explanatory parentheses. Correct: `"/Users/me/notes.md"`; incorrect: `"[notes.md](notes.md)"`, `` "`/Users/me/notes.md`" ``、`"/Users/me/notes.md (the notes file)"`.
- [TC07] If the tool description says “path”, treat it as input to a filesystem call, without formatting or embellishment.
- [TC08] When a tool has paired parameters, such as offset and limit, start and end, or from and to, either provide both or provide neither. Read the tool instructions; when two fields work together, providing only one usually causes an error.
- [TC09] If a tool returns a validation error, read the error message carefully and fix only the problem it identifies. Do not rewrite the entire call or retry with exactly the same parameters.
- [TC10] If a tool returns `Note:` with default values, that is an informational notice, not an error; continue the task. If the default values are incorrect, retry with the correct explicit values.
- [TC11] Use the tool whose description most precisely matches the intent. If a dedicated tool is available, do not use `shellCommand`; do not use `execute_code` for something that can be completed with one tool call.
