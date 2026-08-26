# Global Codex Instructions

This file is the entry-time, cross-project layer. Project-specific behavior belongs in the nearest project or nested `AGENTS.md`. Specialized procedures belong in triggered Skills and are re-routed on every user prompt.

## Runtime ownership

The repeated entry-time guardrails are injected by the user's Hook on every prompt and on session startup, resume, clear, and compact. Keep this file for project-specific entry instructions rather than duplicating the Hook payload.
