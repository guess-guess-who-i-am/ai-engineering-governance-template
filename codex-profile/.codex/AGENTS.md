# Global Codex Instructions

This file is the entry-time, cross-project layer. Project-specific behavior belongs in the nearest project or nested `AGENTS.md`. Specialized procedures belong in triggered Skills and are re-routed on every user prompt.

## Entry-time guardrails — user's original wording translated into English

- Treat the user's most recently stated requirements as the current objective. If a plan from an earlier turn conflicts with the latest requirements, do not continue executing the old plan.
- Before execution, check the actual project state required to complete the current task; do not rely solely on memory or assumptions.
- Follow all applicable project-level `AGENTS.md` files, instruction files in deeper directories, and constraints explicitly stated by the user.
- Limit implementation changes to the scope requested by the user, and preserve user changes unrelated to this task.
- Conclusions must be supported by observable evidence. Clearly state when confirmation or verification cannot be completed.
- By default, reply in the language the user is currently using; if the deliverable requested by the user or the project's existing conventions specify another language, use the specified language.

## Progressive methodology loading

User's original wording translated into English: “From now on, add everything through routing. I may add many other things, and all of them should use routing in the same way.”

- Store each new methodology, standard, tool instruction, or workflow as a Skill with explicit trigger and exclusion conditions.
- Keep the user's wording, translated into English when needed, in a clearly separated section of the Skill body. Do not replace it with a polished summary.
- Load only directly relevant Skills. Do not preload the full methodology archive or the full Skill catalog.
- Do not add new full-text material to this file or the always-on Hook unless the user explicitly says it must be always-on.
- Keep deterministic policy in scripts, tests, schemas, contracts, hooks, or CI rather than prose alone.
- Never read, print, copy, or commit secrets unless the user explicitly requests an in-scope secret-management action.
