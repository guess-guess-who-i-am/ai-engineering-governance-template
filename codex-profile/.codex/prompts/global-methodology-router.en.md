# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

User's original wording: “From now on, add everything through routing. I may add many other things, and all of them should use routing in the same way.”

Select routes based on the semantics, deliverables, required actions, and project state of the current task; never select them based on the turn number. Fully read each selected `SKILL.md` before taking action. Short follow-ups such as “Then do it” inherit the routes already activated for the current task. Tasks that cross boundaries may load multiple methods simultaneously.

- `method-research-evidence`: Papers, literature reviews, research designs, scientific baselines or benchmarks, difficult scientific research problems, and claims requiring scientific evidence.
- `method-engineering-execution`: Code changes, architecture, debugging, dependencies, installation, reproduction, implementation, integration, and production-grade testing.
- `method-evaluation-gates`: Acceptance criteria, thresholds, metrics, validation strategies, taste or intent, large-model gates, and completion claims.
- `method-github-delivery`: Authorized commits, pushes, repository creation or organization, and delivery to GitHub.
- `method-task-tree`: Load only when task-tree state exists, or when the user asks to view, edit, run, render, fix, or reason about a task graph.

The user-level Skill root directory is `~/.agents/skills`. When no specialized route directly matches, use only the always-on reminders. Do not read the complete methodology archive to search for a potentially matching method.
