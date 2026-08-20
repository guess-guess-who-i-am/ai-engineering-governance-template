---
id: US-005
status: verified
risk: high
---

# US-005: 在公开网站理解并检索治理模板

## 用户故事

- Actor: 第一次接触本模板的开发者
- Need: 在窄屏或宽屏阅读治理分层、Skills、质量闭环和设计目录
- Value: 不克隆仓库也能理解适用边界并找到下一步入口

## 验收条件

### AC-001: 完成主要阅读与搜索旅程

- Type: happy
- Given: 文档站已构建并读取 74 条设计 catalog
- When: 用户在桌面或 375px 移动视口阅读并搜索 voice
- Then: 页面无横向溢出且结果出现 ElevenLabs

### AC-002: 键盘和可访问性成立

- Type: accessibility
- Given: 用户只使用键盘并启用 reduced motion
- When: 首次按 Tab、激活跳转链接并浏览页面
- Then: 焦点进入 main，axe 无违规，页面没有强制动画或外部脚本请求

### AC-003: 部署后验证真实 URL

- Type: failure
- Given: Pages workflow 已部署构建产物
- When: workflow 请求输出的 page_url
- Then: 只有 HTTP 200 且正文包含模板标题才视为部署成功

### AC-004: 静态站保持资源预算

- Type: performance
- Given: 文档站、脚本和 74 条设计 catalog 已构建
- When: 统计公开站点的受管静态文件
- Then: 各文件不超过已审查预算、总量不超过 300000 字节且首页不引入重型媒体

## 证据映射

- AC-001: file=scripts/test-docs-site.mjs; workflow=.github/workflows/docs-site.yml
- AC-002: file=scripts/test-docs-site.mjs; workflow=.github/workflows/docs-site.yml
- AC-003: file=.github/workflows/pages.yml; validator=scripts/validate-pages-deployment.ps1
- AC-004: file=scripts/validate-site-performance.ps1; gate=performance-regression

## 测试设计重点

- 主成功路径: AC-001: 在宽屏和窄屏完成阅读与搜索旅程；AC-002: 完成键盘与可访问性旅程
- 重要失败与恢复: AC-003: 部署 URL 非 200 或正文错误时部署验证失败
- 变更影响面: 直接回归阅读、搜索和部署；相邻检查 375px/1440px、键盘焦点、reduced motion、静态资源预算及外部请求

## 非目标

- 不把文档站扩展为 Agent Runtime 或托管用户数据的应用。
