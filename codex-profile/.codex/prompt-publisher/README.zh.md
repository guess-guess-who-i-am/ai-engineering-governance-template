# 全局方法论发布器

中文唯一编辑源是 `~/.codex/prompts/global-methodology-source.zh.md`。它按 `router`、`alwaysOn` 和五个 `method-*` 分类组织；新增、删除、改写或移动方法论时使用 `$manage-global-methodology`。

发布器会完成逐行翻译、完整档案、常驻提醒、路由文件、五个方法 Skill、规则映射和 Skill 索引更新。所有目标先备份后原子替换，后置校验失败会回滚。

不要直接修改自动生成的 `global-every-turn.*`、`global-attention-anchor.*`、`global-methodology-router.*`、`global-methodology-routing-review.zh.md` 或五个方法 Skill 的规则正文，下一次发布会从中文唯一源重新生成它们。

新增方法 Skill 前，先建立 Skill 文件、触发和排除条件，并在 `methodology-targets.json` 登记分类；发布器不会根据分类名猜测路由。

macOS 手动检查：

```bash
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node "$HOME/.codex/prompt-publisher/publish-methodology.mjs" --check
```

如果 Node 已加入 `PATH`，也可以直接使用 `node`。发布器不读取或复制登录凭据。
