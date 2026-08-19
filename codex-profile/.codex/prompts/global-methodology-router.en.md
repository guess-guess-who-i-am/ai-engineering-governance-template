# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

User's original wording: “From now on, add everything through routing. I may add many other things, and all of them should use routing in the same way.”

Select routes according to the semantics, deliverables, required actions, and project state of the current task; never select them according to the turn number. Fully read each selected `SKILL.md` before taking action. Short follow-ups such as “Then do it” inherit the routes already activated for the current task. Multiple methods may be loaded simultaneously for cross-boundary tasks.

- `method-research-evidence`: Papers, literature reviews, research design, scientific baselines or benchmarks, difficult scientific research problems, and claims requiring scientific evidence.
- `method-engineering-execution`: Code modifications, architecture, debugging, dependencies, installation, reproduction, implementation, integration, and product-level testing.
- `method-evaluation-gates`: Acceptance conditions, thresholds, metrics, verification strategies, taste or intent, large-model gates, and completion claims.
- `method-github-delivery`: Authorized commits, pushes, repository creation or organization, and delivery to GitHub.
- `method-task-tree`: Load only when task-tree state exists, or when the user requests viewing, editing, running, rendering, repairing, or reasoning about the task graph.

The user-level Skill root directory is `~/.agents/skills`. When no specialized route directly matches, use only the always-on reminders. Do not read the complete methodology archive merely to look for a potentially matching method.
