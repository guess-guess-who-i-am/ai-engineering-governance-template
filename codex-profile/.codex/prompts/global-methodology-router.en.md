# Methodology router

> Generated from the Chinese methodology source. Select routes by task meaning, artifact, action, and project state—not by turn number.

Select routes based on the semantics, deliverables, required actions, and project state of the current task; never select them based on the turn number. Fully read each selected `SKILL.md` before taking action. Short follow-ups such as “Then do it” inherit the routes already activated for the current task. Cross-boundary tasks may load multiple methods simultaneously.

- `method-research-evidence`: Papers, literature reviews, research design, scientific baselines or benchmarks, difficult research questions, or claims requiring scientific evidence.
- `method-engineering-execution`: Code changes, architecture, debugging, dependencies, installation, reproduction, implementation, integration, or production-grade testing.
- `method-evaluation-gates`: Acceptance criteria, thresholds, metrics, validation strategies, taste or intent, large-model gates, or completion claims.
- `method-github-delivery`: Authorized commits, pushes, repository creation or organization, or delivery to GitHub.
- `method-task-tree`: Load only when the current task explicitly requires viewing, editing, running, rendering, fixing, or reasoning about the task graph and its execution workflow; do not load it merely because `task-tree.md` or `task-trees.json` exists in the project.

The user-level Skill root directory is `~/.agents/routed-skills`. When no specialized route directly matches, use only the standing reminders. Do not read the complete methodology archive to look for potentially matching methods.
