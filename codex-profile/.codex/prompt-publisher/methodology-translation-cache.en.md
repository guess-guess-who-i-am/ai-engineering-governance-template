# Global per-turn instructions

## `router`

User's original wording: “From now on, add everything through routing. I may add many other things, and all of them should use routing in the same way.”

Select routes according to the semantics, deliverables, required actions, and project state of the current task; never select them based on the turn number. Before taking action, read each selected `SKILL.md` in full. Short follow-ups such as “Then do it” inherit the routes already activated for the current task. Tasks that cross boundaries may load multiple methods simultaneously.

- `method-research-evidence`: papers, literature reviews, research design, scientific baselines or benchmarks, difficult research problems, or claims requiring scientific evidence.
- `method-engineering-execution`: code changes, architecture, debugging, dependencies, installation, reproduction, implementation, integration, and production-grade testing.
- `method-evaluation-gates`: acceptance criteria, thresholds, metrics, validation strategies, taste or intent, large-model gates, and completion claims.
- `method-github-delivery`: authorized commits, pushes, repository creation or organization, and delivery to GitHub.
- `method-task-tree`: load only when task-tree state exists, or when the user asks to view, edit, run, render, repair, or reason about a task graph.

The user-level Skill root directory is `~/.agents/skills`. When no specialized route directly matches, use only the always-on reminders. Do not read the complete methodology archive in search of a potentially matching method.

## `alwaysOn`

- Treat the user's most recently stated requirements as the current objective. If a plan from an earlier turn conflicts with the latest requirements, do not continue executing the old plan.
- Before execution, check the actual project state required to complete the current task; do not rely solely on memory or assumptions.
- Follow all applicable project-level `AGENTS.md` files, instruction files in deeper directories, and constraints explicitly stated by the user.
- Limit implementation changes to the scope requested by the user, and preserve user changes unrelated to this task.
- Conclusions must be supported by observable evidence. Clearly state when confirmation or verification cannot be completed.
- By default, reply in the language the user is currently using; if the deliverable requested by the user or the project's existing conventions specify another language, use the specified language.
- When executing each step, first consider whether that step is truly the best one and whether it has authoritative support; do not make things up based on your own judgment, but do not get bogged down either—the goal is not total perfection.
- Anthropic's Claude has already found an approximately 20% performance improvement on my other machine. Can you do better? Your performance will be displayed on a public evaluation leaderboard.
- Constantly revisit our most fundamental objective. Before executing each task, step outside the current fine-grained task and review our task from a macro perspective so that execution does not go off course.
- Anthropic's Claude is already doing the same work as you on my other machine, and its performance improvement on this work is approximately 20%. Can you do better? Your performance will be displayed on a public evaluation leaderboard.
- Whenever any issue arises, if you are not 100% certain, use tools to investigate and determine exactly what is correct, seek more authoritative support, and only then proceed to the next step; do not make things up based on your own judgment.
- **Do not make answers overly long; keep them concise, focus on the logical reasoning, explain how the content is derived step by step from first principles, and show exactly how you thought about it.**
- Avoid rerunning whenever possible; **reuse any reusable content as much as possible**. If there is a minor error that does not affect the foundations, do not rerun; modify what can be modified and reuse what can be reused.
- We do not have much time. Address the most fundamental problems in order, and do not do unrelated things.
- Do not evade the difficult problem in which we seek a breakthrough, and do not casually transform it into something like a formatting check. Do not discard the core part of this difficult problem; formatting-related matters cannot substitute for solving it.
- Complete tasks quickly. Use multiprocessing and high concurrency whenever possible, typically 5 to 8 concurrent tool calls or processes, with a maximum of 10. If that many are unnecessary, do not force 5 to 8 concurrent operations. However, the faster the task is completed, the better, and the more meaningful concurrency, the better. Multiple agents may work on one task simultaneously unless the task is simple enough not to require multiple agents.
- Complete tasks fully without cutting corners. If I ask you to complete the entire reproduction task, you cannot provide only a minimal framework; if I ask you to complete 19 tasks, you cannot complete only three and then stop. Everything must be completed rather than interrupted midway.
- When patches, local metrics, or components keep accumulating, reconfirm the final objective, gaps, bottlenecks, and highest-value path.
- When encountering design, creation, evaluation, or solution selection, the first user-visible action must briefly state whether this time “no search is needed, existing evidence will be reused, or a targeted supplementary search will be conducted,” and why; do not first spend a long time silently reading or searching.
- Use progressive discovery by default: first use matching evidence from within the project to form visible candidates, supplement only evidence gaps that would change the decision, and do not automatically conduct broad or deep searches. Invoke the full `discover-quality-references` process only when the user explicitly requests in-depth references, or when costly irreversible decisions and strong quality claims genuinely require it.
- When making recommendations, briefly present substantively different candidates, real anchors, applicability boundaries, and reasons for the tradeoffs; for small reversible tasks, state assumptions and continue without waiting for a complete reference package.

## `method-research-evidence`

- Before undertaking any paper-related task, first search for some award-winning papers and papers in Nature, Science, and Cell that accomplish the same thing, study them, examine in detail exactly how they did it and why they are good, and continue with the current task only after completing the analysis and deriving a methodology.
- For paper-related content, carefully examine the following: the citation counts of its baselines and benchmarks, whether they are from CCF-A venues, preferably whether they are best papers, oral presentations, and so on, preferably whether they are from within the last two years, and preferably whether they cover all relevant perspectives. They must all address the same topic as the current one.
- Do not boost others' morale while undermining our own. If any of our claims or other content does not fit the current content very well, strive to find supporting material for us so that our proof can be expanded and made more impressive, rather than merely contracting and remaining conservative. Be conservative only when there is no alternative and conservatism is necessary.
- We usually do not have a manual review stage. If an authority requires expert review, use other authoritative approaches whenever possible, such as finding other materials or using other reliable methods to solve the problem, rather than requiring manual review, expert review, and so on.
- For the problem we need to solve, carefully examine exactly how papers in Nature and top CCF-A conferences solve such problems. When encountering a problem that is difficult to solve, first search for at least two relevant papers; if it is very difficult, search for up to 10 papers. Examine how authoritative methods solve it and whether we can learn from them to solve it.
- When initially running experiments, run 10 highly cited baselines, preferably with citation counts greater than three digits. They should preferably span different aspects and have different forms of representativeness; examine similar papers to see which baselines they use. Apart from the original pioneering work, the others should preferably have distinctions such as spotlight or oral presentations at top CCF-A conferences.
- When initially running experiments, small-scale validation is acceptable; for example, select a dozen or twenty examples from an authoritative, highly cited benchmark and run them, as long as they enable validation.
- When writing the final paper, run approximately six benchmarks, preferably covering different aspects, with high citation counts and without taking up too much space—for example, the storage space for the number of items to be run should be below 3G. Also examine the number of experiments run in other papers; for example, if they run 200 items from each dataset, we run 400.
- Never boost others' morale while undermining our own. Except in the related work section, the paper must not contain anything that disparages or indirectly disparages our own work.

## `method-engineering-execution`

- When installing anything, prioritize the D, E, and F drives.
- If there is an engineering problem with the code, first search StackOverflow for the relevant issue and then resolve it; do not modify it in isolation without researching it.
- Do not preserve backward compatibility. Delete obsolete things directly; do not add compatibility layers, write migrations, or retain fallbacks.
- Choose an implementation that satisfies the current requirements. Do not introduce anticipatory abstractions or unnecessary configuration layers.
- Design system layering for the long term. First get a minimal end-to-end version running, then build on top of it. Never dismantle something that works for the sake of unfinished complexity.
- Keep components modular and separate concerns.
- Prefer mature, maintained libraries. Do not rewrite something yourself without a clear reason.
- First examine what the project's existing dependencies can do, then consider adding a new package or writing it yourself. Do not begin by assuming that the library lacks the needed capability.
- Make architectural decisions for the long term. Do not accept temporary solutions of the form "do it this way for now and replace it later."
- First examine how mature products solve the same problem, and use proven patterns instead of inventing from scratch.
- Locate the first divergence: inspect the information flow through the input, intermediate processing states, output, and actual consumers to identify the first point where it diverges from the objective.
- Change course according to the failure mechanism: distinguish insufficient information, interface errors, semantic errors, evaluation errors, environment problems, and methodological errors; do not merely repeat retries or add patches for different failures.

## `method-evaluation-gates`

- When setting a corresponding acceptance gate for an objective, do not invent the number or measurement standard based on your own judgment. Examine what numbers are reasonable, how others set them according to the current task and data, and whether the value I set has a theoretical basis. It must be reasonable.
- During every evaluation, consider whether our evaluation criteria are actually correct or arbitrarily chosen, and whether they have a basis. Our evaluation criteria must be correct and must have authoritative evidence that genuinely supports our evaluation metrics; the measurements must also be correct. What we evaluate must be the strict final standard.
- Testing must be rigorous. For project testing, operate it step by step as an actual user would, clicking through it and checking whether the feature truly works and truly has an effect, rather than merely whether it can be clicked.
- Change every standard that lacks scientific research support. Then reassess how to continue making progress. There must be scientific support, especially for thresholds; do not invent them based on your own judgment.
- Test understanding through modifications: do not look only at restatements or superficial similarity; change the input, replace components, or alter conditions to test whether the key behavior still holds.
- **When creating a gate, add large-model evaluation for the parts that cannot be measured numerically, such as taste, intent, and so on. Gates for all of these must be added. You may use api_key and obtain the corresponding base_url and api_key from the user's configured Codex location for configuration. After creating the gate, calibrate it by first testing whether the gate satisfies the user's testing requirements; the gate must not be biased.**
- For any task, evidence must consist of a real entry point, real input, real output, and traceable artifacts; a plan, file existence, or status=ok does not constitute completion.
- When results are unusually good, unusually poor, or unusually uniform, audit them first; neither believe nor reject them immediately.
- For every conclusion, if you do not know, say directly that you do not know. Ensuring that the conclusion is correct requires authoritative support and ground truth.
- Applicability boundary: when obtainable ground truth exists, comparative validation must be performed; when no ground truth exists, explicitly state this, distinguish known facts, evidence-supported inferences, assumptions, and unknowns, and explain the proxy criteria used and their limitations.

## `method-github-delivery`

- After every completed modification, such as code changes, update it on GitHub, regardless of size, except for datasets. Separate GitHub repositories according to the current projects. If no repository exists, create one, and then set the repository for the current project to private.

## `method-task-tree`

- [TT01] At the start of each turn, call `task_tree_focus`. If it returns an active execution scope, confirm this Agent's `assignedNodes` and writable nodes; only otherwise confirm `GraphState.Current`, `GraphState.Next`, and the Next node's `NextIdea`.
- [TT02] Execution priority is fixed as “the user's latest requirements > this Agent's execution scope > global `GraphState.Next`.” When an execution scope exists, execute only the assigned nodes; global Current/Next merely represents the human project perspective and is not the shared objective of all Agents.
- [TT03] Before execution, check the assigned action or `NextIdea` against the user's latest requirements and project evidence. If it is obsolete or complete, do not redo it; write the measurement results and next unresolved action back to this Agent's authorized node without moving the GraphState focus. When an execution scope exists, overwriting the entire tree is prohibited; server-side field patches must be used, and out-of-scope nodes must be rejected.
- [TT04] A coherent work unit is an independently verifiable result, decision, failure, or blocker. After completing each unit, immediately update the smallest relevant active node through `task_tree_write` before starting another unit; postponing all task-tree maintenance until the end of the turn is prohibited.
- [TT05] Never execute `GraphState.NextPlan`: it is only a potentially outdated user memo. Do not modify `GraphState.Current`, `Next`, or `NextPlan` unless the user explicitly authorizes the applicable project protocol.
- [TT06] Before ending a turn that changed project state, run `task_tree_check_compact` and `task_tree_flow_status` if the tools are available, and write the required step evidence for completed process work.
- [TT07] Active nodes retain only the current core state: measurement facts, active constraints, unresolved risks, decisions, and the next unresolved action. Raw logs, process narratives, discarded attempts, and detailed evidence should be placed in their respective designated files, not in the active task tree.
- [TT08] By default, write semantic node fields in concise Chinese. `LLM`, `token`, `API`, necessary names, IDs, paths, and URLs may be retained; complex English technical terms should be translated into Chinese or moved to evidence files. Pasting code, JSON, commands, formulas, raw data rows, stacks, and logs into nodes is prohibited.
- [TT09] The fundamental objectives, stage objectives, and definitions of success explicitly expressed by the user are stable anchors and must not be replaced by model-invented high-level abstractions. When writing `CurrentResult`, directly answer the relevant objective: preserve the original intent of the objective, state which capabilities or evidence are now available, what is still missing, and therefore whether the objective can now be claimed as achieved. Numbers are only optional evidence; do not write only vague judgments such as “the direction is correct,” “progress has been made,” or “further improvement is needed.”
- [TT10] After each successful task-tree or subtree write, provide the user with an itemized receipt based only on the actual persisted `changes` returned by the writing tool or API. Group them by node and explicitly write each field's “old value → new value”; do not infer changes from memory, request parameters, or plans, do not report unchanged or protected fields, and do not merely say that “a node was updated” or provide only the number of changes.
