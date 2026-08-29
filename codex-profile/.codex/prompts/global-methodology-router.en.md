# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

User's original text: “From now on, use the route-finding approach for anything added. I may add many other things, and they should all be handled using the route-finding approach as well.”

Select a route based on the semantics, artifacts, required actions, and project state of the current task; never select based on which round it is. Before acting, fully read every selected `SKILL.md`. Short follow-up prompts such as “Then do it” inherit the route already activated for the current task. Cross-boundary tasks may load multiple methods simultaneously.

- `method-research-evidence`: papers, literature reviews, research designs, scientific baselines or benchmarks, difficult scientific research problems, and claims requiring scientific evidence.
- `method-engineering-execution`: code changes, architecture, debugging, dependencies, installation, reproduction, implementation, integration, and product-level testing.
- `method-evaluation-gates`: acceptance criteria, thresholds, metrics, verification strategies, taste or intent, large-model gates, and completion claims.
- `method-github-delivery`: authorized commits, pushes, creating or organizing repositories, and delivery to GitHub.
- `method-task-tree`: Load only when the current task explicitly requires viewing, editing, running, rendering, fixing, or reasoning about task graphs and their execution flows; must not load merely because `task-tree.md` or `task-trees.json` are present in the project.

The user-level Skill root directory is `~/.agents/routed-skills`. When no specialized route directly matches, use only the standing reminders. Do not read the complete methodology archive merely to look for potentially matching methods.
