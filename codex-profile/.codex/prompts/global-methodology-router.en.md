# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

The user's original wording: “From now on, use the route-finding approach for everything added. I may add many other things; have them all follow the route-finding approach as well.”

Select routes based on the current task's semantics, artifacts, required actions, and project state; never select by round number. Read each selected `SKILL.md` in full before acting. Short follow-ups such as “Then do it” inherit the routes already activated for the current task. Tasks that cross boundaries may load multiple methods simultaneously.

- `method-research-evidence`: Papers, literature reviews, research design, scientific baselines or benchmarks, difficult scientific research problems, and claims requiring scientific support.
- `method-engineering-execution`: Code changes, architecture, debugging, dependencies, installation, reproduction, implementation, integration, and production-grade testing.
- `method-evaluation-gates`: Acceptance criteria, thresholds, metrics, verification strategies, taste or intent, large-model gates, and completion claims.
- `method-github-delivery`: Authorized commits, pushes, repository creation or organization, and delivery to GitHub.
- `method-task-tree`: Load only when the current task explicitly requires viewing, editing, running, rendering, repairing, or reasoning about the task graph and its execution flow; do not load merely because `task-tree.md` or `task-trees.json` exists in the project.

The user-level Skill root directory is `~/.agents/routed-skills`. When no specialized route directly matches, use only the standing reminders. Do not read the complete methodology archive to search for potentially matching methods.
