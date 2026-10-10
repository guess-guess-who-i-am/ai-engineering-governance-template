# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

User's original wording: “From now on, add everything using the routing approach; I may want to add many other things, and have them all handled using the routing approach as well.”

Select the route based on the semantics of the current task, its artifacts, the actions it requires, and the project state; absolutely never based on which turn it is. Before acting, read every selected `SKILL.md` in full. Short follow-ups such as “Then do it” inherit the routes already activated for the current task. Cross-boundary tasks may load multiple methods at the same time.

- `method-research-evidence`: papers, literature reviews, research design, scientific baselines or benchmarks, difficult scientific research problems, and claims requiring scientific support.
- `method-engineering-execution`: code changes, architecture, debugging, dependencies, installation, reproduction, implementation, integration, and product-level testing.
- `method-evaluation-gates`: acceptance conditions, thresholds, metrics, verification strategies, taste or intent, large-model gates, and completion claims.
- `method-github-delivery`: authorized commits, pushes, repository creation or organization, and delivery to GitHub.
- `method-task-tree`: load only when task-tree state exists, or when the user asks to view, edit, run, render, repair, or reason about the task graph.

The user-level Skill root directory is `~/.agents/skills`. When no specialized route directly matches, use only the always-on reminders. Do not read the full methodology archive in order to search for a possibly matching method.
