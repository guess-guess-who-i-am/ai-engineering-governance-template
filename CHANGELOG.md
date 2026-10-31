# Changelog

本项目遵循语义化版本。`Unreleased` 只记录尚未发布的用户可见变化；已发布条目不得改写事实。

## Unreleased

## 0.3.0 - 2026-09-21

### Added

- macOS 一键全局部署入口，安装后同一用户的全部 Codex 工作区共享配置。
- macOS 安装、漂移检查、22 个全局 Skills、路由、20 路并发和回滚的端到端测试。

### Changed

- Codex profile 收敛为 macOS 版本，CI 在 macOS runner 验证，不再发布 Windows 或 Linux 安装器。
- 22 个 Skills 统一以非自动发现的 `codex-profile/global-skills` 为版本源，运行时只安装到 `~/.agents/skills`。
- 新项目不再复制项目级 Skills 或全局 profile 部署脚本。

## 0.2.0 - 2026-08-16

### Added

- 五个专项 Skills：改动审查、治理审计、TDD 回归修复、领域建模和 PR 说明。
- P0–P3 Findings Schema、去重、生命周期、责任人和手动 GitHub Issue 同步。
- 74 条固定来源的 DESIGN.md 目录、搜索、安装和 provenance。
- 公开文档站、真实浏览器可访问性测试、GitHub Pages 和部署 smoke。
- 上游漂移、版本发布、文档链接、编码和依赖安全门禁。

### Changed

- 统一全部 Skill 的中文 UI metadata，并拒绝乱码、重复显示名和错误 Skill 引用。
- 质量报告升级为包含稳定 Finding 的 `quality-gate-report/v2`。
