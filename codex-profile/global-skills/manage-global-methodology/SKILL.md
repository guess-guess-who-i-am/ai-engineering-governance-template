---
name: manage-global-methodology
description: Manage the user's routed global methodology system. Use when the user wants to open the methodology editor; add, delete, rewrite, move, translate, or publish methodology rules; change always-on reminders or route text; or create, rename, or remove a method-* Skill. Do not trigger for ordinary project code changes or for using a methodology without modifying its configuration.
---

# Manage Global Methodology

User's original governing rule translated into English: “From now on, add everything through routing. I may add many other things, and all of them should use routing in the same way.”

## Existing categories

Treat `~/.codex/prompts/global-methodology-source.zh.md` as the only manually editable methodology source.

- Open it through the desktop shortcut `编辑并发布全局 Prompt.lnk` or `编辑并发布全局方法论.lnk` when the user asks to edit manually.
- Before an Agent edits the source directly, copy it to `~/.codex/prompts/backups/methodology-source`; the desktop watcher performs this backup automatically.
- Add, delete, rewrite, or move one complete `- ` rule under an existing stable section ID.
- Preserve the user's Chinese wording. Do not directly edit generated English text.
- Do not directly edit generated archives, anchors, routers, review files, maps, or the rule bodies of existing `method-*` Skills; the publisher overwrites them.
- Publish with `node "$HOME/.codex/prompt-publisher/publish-methodology.mjs" --config "$HOME/.codex/prompt-publisher/methodology-targets.json"`.
- Run `--check` for a no-model integrity check. Use `--dry-run` to translate and build candidates without writing.

The publisher must translate line by line, enforce stable section IDs, reject duplicate rules, enforce the Hook context budget, back up targets, update all mirrors and Skills atomically, refresh the Skill registry, and roll back on failed post-publish validation.

## New or removed categories

Do not infer a new Skill's triggers from its name alone. Before adding a new `method-*` section:

1. Define concrete trigger and exclusion examples with the user.
2. Create the user-level Skill under `~/.agents/skills` with `skill-creator`.
3. Add the Skill to `methodology-targets.json` with a stable ID, Chinese title, English title, and `skillFile`.
4. Add the same stable section ID and its rules to the Chinese source.
5. Update the `router` section and `~/.codex/skill-registry/routing-rules.json`.
6. Publish, test positive and negative routing prompts, and run the integrity validator.

For category deletion, first back up the source, Skill, route configuration, and aliases. Remove all four surfaces in one coherent change; never leave an orphan Skill or a route pointing to a missing file.
