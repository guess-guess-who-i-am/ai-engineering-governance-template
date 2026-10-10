---
name: build-designed-interface
description: Build or redesign user interfaces from a product brief, existing UI, screenshots, or DESIGN.md while preserving usability, accessibility, responsiveness, and brand coherence. Use for substantial frontend design and implementation. Do not use for dense dashboards unless the selected product design system explicitly covers them.
---

# Build Designed Interface

## Workflow

1. Inspect the existing application, routes, component library, dependencies, screenshots, tests, and nearest instructions.
2. Classify the task as greenfield, preserve-redesign, or visual overhaul. On redesigns, audit brand tokens, information architecture, content, accessibility, analytics hooks, and recognizable interaction patterns before editing.
3. Read the project `DESIGN.md`. If absent, write a one-line design read covering audience, mood, layout family, density, motion, and accessibility needs.
4. Before choosing an external visual reference, run `scripts/route-design-references.ps1` with 1-3 brief keywords and (when known) the catalog product type. It reads only the lightweight catalog and returns at most five candidates. Install or read one candidate only after it is materially relevant.
5. Route specialized design work by trigger: use `design-taste-frontend` for landing pages, portfolios, and redesigns; use `apple-design` for gesture-driven or spring-based interaction. Do not load either adapter for static utility work.
6. Choose a mature design system when the product type has established interaction patterns. Use custom visual direction only where it adds real product meaning.
7. Establish semantic tokens for color, type, spacing, radius, elevation, and motion. Keep one coherent system across the surface.
8. Implement the smallest complete user journey first, including loading, empty, error, focus, keyboard, reduced-motion, and mobile behavior where applicable.
9. Use motion only for hierarchy, feedback, storytelling, or state transition. Gesture-driven motion must be responsive, interruptible, and velocity-aware when the interaction calls for it.
10. Test at representative narrow and wide viewports and with keyboard navigation. Run automated accessibility and contrast checks when the stack supports them.
11. Compare the result against the brief and `DESIGN.md`. For taste or intent that cannot be measured mechanically, run a blinded LLM review using [references/qualitative-gate.md](references/qualitative-gate.md), then inspect the concrete evidence yourself.

Read [references/interface-gate.md](references/interface-gate.md) before final delivery.
