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
5. Show the resulting brief and ask whether to create the private GitHub repository now.

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

The qualitative LLM gate is excluded by default so a new repository starts with green deterministic CI. Pass `-IncludeQualitativeGate` only when the user has a GitHub-runner-accessible endpoint and intends to configure `LLM_BASE_URL` and `LLM_API_KEY` for the new repository.

## Verify And Continue

1. Confirm the script reports a successful repository check and initial commit.
2. Read the generated `PROJECT_BRIEF.md`, `CONTEXT.md`, and `AGENTS.md` from the new repository.
3. Report the local path and GitHub URL when created.
4. Continue in the new repository with its first end-to-end slice. Do not keep product implementation inside the governance-template repository.

If remote creation fails, preserve the completed local repository and report the exact retry command instead of rebuilding it.
