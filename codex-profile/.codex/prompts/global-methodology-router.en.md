# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

User's original text: “From now on, use the route-finding approach for all additions; I may add many other things, and have them all handled using the route-finding approach as well.”

Select routes based on the current task's semantics, artifacts, required actions, and project state; never based on which round it is. Before acting, fully read every selected `SKILL.md`. Short follow-up questions such as “Then do it” inherit the routes currently activated by the task. Cross-boundary tasks may load multiple methods simultaneously.

- `method-research-evidence`: papers, literature reviews, research designs, scientific baselines or benchmarks, difficult research problems, or claims requiring scientific support.
- `method-engineering-execution`: code modifications, architecture, debugging, dependencies, installation, reproduction, implementation, integration, or product-level testing.
- `method-evaluation-gates`: acceptance criteria, thresholds, metrics, verification strategies, taste or intent, large-model gates, or completion claims.
- `method-github-delivery`: authorized commits, pushes, repository creation or organization, or delivery to GitHub.
- `method-task-tree`: Load only when the current task explicitly requires viewing, editing, running, rendering, fixing, or reasoning about task graphs and their execution workflows; do not load merely because the project contains `task-tree.md` or `task-trees.json`.

The user-level Skill root directory is `~/.agents/routed-skills`. When no specialized route directly matches, use only the persistent reminders. Do not read the complete methodology archive merely to look for potentially matching methods.
