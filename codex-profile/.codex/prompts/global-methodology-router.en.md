# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

User's original wording: “From now on, add everything by finding a route. I may add many other things, and all of them should also be done by finding a route.”

Select routes based on the semantics of the current task, its deliverables, the required actions, and the project state; never select them based on the turn number. Fully read every selected `SKILL.md` before taking action. Short follow-ups such as “Then do it” inherit the routes already activated for the current task. Tasks that cross boundaries may load multiple methodologies simultaneously.

- `method-research-evidence`: Papers, literature reviews, research design, scientific baselines or benchmarks, difficult scientific research problems, and claims requiring scientific evidence.
- `method-engineering-execution`: Code modifications, architecture, debugging, dependencies, installation, reproduction, implementation, integration, and production-grade testing.
- `method-evaluation-gates`: Acceptance criteria, thresholds, metrics, validation strategies, taste or intent, large-model gates, and completion claims.
- `method-github-delivery`: Authorized commits, pushes, repository creation or organization, and delivery to GitHub.
- `method-task-tree`: Load only when task-tree state exists, or when the user asks to view, edit, run, render, repair, or reason about a task graph.

The user-level Skill root directory is `~/.agents/skills`. When no specialized route directly matches, use only the persistent reminders. Do not read the complete methodology archive merely to look for a potentially matching methodology.
