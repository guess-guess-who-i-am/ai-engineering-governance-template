---
name: design-taste-frontend
description: Apply anti-template visual direction to landing pages, portfolios, and redesigns. Use after the product brief is known; do not use for dense dashboards or utility-only screens.
---

# Design Taste Frontend

Use this as a routed, on-demand design review. Do not preload it for ordinary engineering work.

## Workflow

1. Read the brief, audience, existing brand assets, and project `DESIGN.md`.
2. Before implementation, state one concise Design Read: page kind, audience, visual language, and chosen design-system or aesthetic family.
3. If the brief is genuinely ambiguous and the choices would materially change the result, ask one clarifying question. Otherwise state the assumption and proceed.
4. Set three local dials for the surface: `DESIGN_VARIANCE`, `MOTION_INTENSITY`, and `VISUAL_DENSITY`. Use them to explain decisions; do not turn them into global project settings.
5. Reject generic defaults unless the brief supports them: purple AI gradients, centered dark mesh heroes, three identical feature cards, indiscriminate glassmorphism, and decorative motion everywhere.
6. Prefer one official design system when the product type has one. Do not mix component systems or recreate their tokens by hand.
7. Finish the smallest complete journey, including loading, empty, error, focus, keyboard, mobile, and reduced-motion states where relevant.
8. Review the rendered result against the brief and `DESIGN.md`; record concrete observations and the selected reference IDs.

## Routing boundary

- Use `apple-design` only when gesture-driven interaction, spring motion, spatial continuity, materials, or interaction latency is central.
- Use `scripts/route-design-references.ps1` for a small catalog search before choosing an external visual reference. Search the catalog; do not read the whole mirror.
- Do not use this Skill as a substitute for accessibility, functional, or performance tests.

## Source provenance

This is a compact project adapter based on the MIT-licensed Taste Skill repository:
https://github.com/Leonxlnx/taste-skill

The adapter preserves the operational decisions needed by this template while keeping the full upstream mirror out of the per-task context.
