# 分支与发布

## 分支

`main` 保持可验证并通过受保护 PR 合并。每项独立结果使用短生命周期 `codex/<outcome>` 分支；PR 说明包含 Outcome、Scope、Evidence 和 Risk。P0/P1 未关闭时不得发布。

## 版本

`VERSION`、`package.json` 与 `CHANGELOG.md` 的版本必须一致，并使用 `MAJOR.MINOR.PATCH`。破坏公共模板契约提升 major；向后兼容能力提升 minor；兼容修复提升 patch。

## 发布步骤

1. 把 Unreleased 内容归入新版本和日期，同时更新 `VERSION` 与 `package.json`。
2. 运行 `scripts/invoke-quality-gates.ps1 -Profile release`，处理全部阻断 Finding。
3. 合并 PR 后创建与版本完全一致的 `v<version>` tag 并推送。
4. `release.yml` 重新验证版本和 release profile，再创建 GitHub Release 并附加质量报告。
5. 检查 Pages 部署 smoke 和 GitHub Release 内容；失败时保留 tag，修复后重新运行 workflow，不伪造新版本。

发布 workflow 不接受 pull request 输入，只在受保护历史上的版本 tag 触发，并使用 GitHub 自带 token 的最小 `contents: write` 权限。
