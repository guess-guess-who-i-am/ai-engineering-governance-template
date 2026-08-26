---
name: start-new-project
description: Guide a user from a rough idea to a concise project brief, then bootstrap a separate local Git repository and optionally create a private GitHub repository. Use when the user asks to start, initialize, scaffold, or configure a new project from this governance template, especially when they want Codex to help fill required decisions. Do not use for adding a feature to an existing product.
---

# Start New Project

Build the brief conversationally, then delegate filesystem and Git operations to `scripts/new-project.ps1`.

## Interview

Ask one question at a time. Reuse answers already present in the conversation or repository.

1. Identify the intended user and the concrete result they should obtain.
2. Propose a lowercase kebab-case repository name and a human-facing display name.
3. Define the first end-to-end slice as `input -> behavior -> user-visible result`.
4. Classify the project as `web`, `api`, `cli`, `research`, or `other`.
5. Turn the first slice into `US-001` with a happy and relevant failure acceptance criterion.
6. Decide whether the outcome crosses multiple Stories or boundaries and therefore needs a User Journey. Record persistent, scarce, paid, privileged, or data-bearing resources without collecting secret values.
7. Show the resulting brief and ask whether to create the private GitHub repository now.

Do not ask for API keys in chat or write secrets to files. Repository creation is an external action: run it only after explicit confirmation.

## Bootstrap

From the governance-template root, run:

```powershell
./scripts/new-project.ps1 `
  -ProjectName <repository-slug> `
  -DisplayName <display-name> `
  -Audience <intended-user> `
  -Outcome <observable-result> `
  -FirstSlice <first-end-to-end-slice> `
  -ProjectType <type> `
  -NonInteractive `
  [-CreateGitHub]
```

Pass `-Destination` only when the user chooses a non-default location. The default is a sibling directory of this template. GitHub repositories are always private.

The generated repository always carries the full quality-category manifest. Product-specific gates start as release-blocking `planned` decisions until `$establish-test-strategy` connects real stack commands. The qualitative LLM implementation is excluded by default; pass `-IncludeQualitativeGate` when the user has a GitHub-runner-accessible endpoint and intends to configure `LLM_BASE_URL` and `LLM_API_KEY`. If excluded, it remains an explicit release-blocking plan rather than disappearing.

## Verify And Continue

1. Confirm the script reports a successful repository check and initial commit.
2. Read the generated `PROJECT_BRIEF.md`, `CONTEXT.md`, `AGENTS.md`, `requirements/user-stories/US-001-first-slice.md`, and `quality/gates.json`.
3. Use `docs/PROJECT_LIFECYCLE.md` for Gate 0 and `docs/DOCUMENTATION_AUTHORITY.md` to place later facts. Use the generated Build Plan only when its high-impact conditions apply.
4. Use `$establish-test-strategy` after choosing the stack; replace planned gates with commands before release.
5. Report the local path and GitHub URL when created.
6. Continue in the new repository with its first end-to-end slice. Do not keep product implementation inside the governance-template repository.

If remote creation fails, preserve the completed local repository and report the exact retry command instead of rebuilding it.
