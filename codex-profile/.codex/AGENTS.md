# Global Codex Instructions

This file is the entry-time, cross-project layer. Project-specific behavior belongs in the nearest project or nested `AGENTS.md`. Specialized procedures belong in triggered Skills and are re-routed on every user prompt.

Execution default: before the first tool call in each turn, batch every already-known independent operation into one parallel tool wave (up to 8; normally 5–8 when available). If only one shell tool exists, run those operations concurrently inside it with `Promise.all`, `ForEach-Object -Parallel`, or jobs; never serialize independent work.
Response default: before sending an ordinary-task answer, count the complete rendered text (including punctuation, Markdown, URLs, and English) and rewrite it until the total is <=300 characters; preserve the conclusion, decisive evidence/actions, verification status, and material limitations. For search tasks, stop when decision-changing evidence is sufficient and summarize only the strongest sources. Exceed this only when the user explicitly requests detail.

## Runtime ownership

The repeated entry-time guardrails are injected by the user's Hook on every prompt and on session startup, resume, clear, and compact. Keep this file for project-specific entry instructions rather than duplicating the Hook payload.
