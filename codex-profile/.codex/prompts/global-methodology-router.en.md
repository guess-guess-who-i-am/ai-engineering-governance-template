# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

User's original text: “From now on, additions should all use the routing approach. I may want to add many other things, and let them also be done according to the routing approach.”

Select routing based on the semantics of the current task, its deliverables, the actions required, and project state; absolutely do not select it based on the round number. Before acting, read every selected `SKILL.md` in full. Short follow-up questions such as “Then do it” inherit the route already activated for the current task. Cross-boundary tasks may load multiple methods simultaneously.

- `method-research-evidence`: papers, literature reviews, research design, scientific baselines or benchmarks, difficult scientific research problems, and claims requiring scientific evidence.
- `method-engineering-execution`: code changes, architecture, debugging, dependencies, installation, reproduction, implementation, integration, and product-level testing.
- `method-evaluation-gates`: acceptance conditions, thresholds, metrics, verification strategies, taste or intent, large-model gates, and completion claims.
- `method-github-delivery`: authorized commits, pushes, repository creation or organization, and delivery to GitHub.
- `method-task-tree`: load only when task-tree state exists, or when the user asks to view, edit, run, render, repair, or reason about the task graph.

The user-level Skill root directory is `~/.agents/skills`. When no specialized route directly matches, use only the always-on reminder. Do not read the complete methodology archive merely to search for a possibly matching method.
