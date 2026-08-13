---
version: 0.1.0
name: engineering-governance-template
description: A calm, evidence-first interface language for engineering tools and documentation. Content hierarchy and trustworthy state communication take priority over decorative branding.
---

# 设计系统

本模板默认用于工程工具、文档和内部产品。视觉目标是清晰、克制、可信，而不是复制某个品牌。

## Tokens

```yaml
colors:
  canvas: "#F7F7F5"
  surface: "#FFFFFF"
  ink: "#171717"
  body: "#454545"
  muted: "#737373"
  hairline: "#DEDEDA"
  accent: "#176B5B"
  accent-strong: "#0E4F43"
  success: "#237A4B"
  warning: "#9A6700"
  error: "#B42318"
spacing:
  unit: "4px"
  content-gap: "24px"
  section-gap: "72px"
radius:
  control: "8px"
  panel: "12px"
typography:
  body: "system-ui, sans-serif"
  code: "ui-monospace, monospace"
  measure: "68ch"
```

## 原则

- 信息架构先于装饰；主操作、状态、证据和风险必须容易扫描。
- 颜色承担语义，不使用随机渐变或多套 accent。
- 面板通过 hairline、留白和轻微层级区分，不堆叠强阴影。
- 工程数据使用等宽字体，但正文保持高可读性。
- 动效只解释状态变化或提供反馈，并支持 reduced motion。
- 深色模式必须保持同等层级和对比度，不能简单反相。
- 所有多栏布局必须定义移动端折叠顺序。

## 组件语言

- Primary action：单一 accent 实心按钮。
- Secondary action：surface + hairline，不与主操作竞争。
- Status：图标、文字和颜色共同表达，不能只依赖颜色。
- Evidence panel：显示检查名称、范围、结果、时间与日志入口。
- Risk callout：说明影响、触发条件和下一动作，避免只有“警告”字样。
- Tables：用于精确映射和比较；移动端转为有标签的记录块。

## 禁止项

- 不用装饰性 AI 紫色光晕表达“智能”。
- 不把每个内容区都包装成相同圆角卡片。
- 不用无依据百分比、评分或性能数字制造可信感。
- 不用动画掩盖等待、错误或未完成状态。

