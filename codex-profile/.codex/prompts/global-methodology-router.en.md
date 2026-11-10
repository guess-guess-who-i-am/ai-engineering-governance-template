# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

User's original wording: “From now on, add everything through routing. I may add many other things, and all of them should use routing in the same way.”

Select routes according to the semantics, deliverables, required actions, and project state of the current task; never select them based on the turn number. Before taking action, read each selected `SKILL.md` in full. Short follow-ups such as “Then do it” inherit the routes already activated for the current task. Tasks that cross boundaries may load multiple methods simultaneously.

- `method-research-evidence`: papers, literature reviews, research design, scientific baselines or benchmarks, difficult research problems, or claims requiring scientific evidence.
- `method-engineering-execution`: code changes, architecture, debugging, dependencies, installation, reproduction, implementation, integration, and production-grade testing.
- `method-evaluation-gates`: acceptance criteria, thresholds, metrics, validation strategies, taste or intent, large-model gates, and completion claims.
- `method-github-delivery`: authorized commits, pushes, repository creation or organization, and delivery to GitHub.
- `method-task-tree`: load only when task-tree state exists, or when the user asks to view, edit, run, render, repair, or reason about a task graph.

The user-level Skill root directory is `~/.agents/skills`. When no specialized route directly matches, use only the always-on reminders. Do not read the complete methodology archive in search of a potentially matching method.
