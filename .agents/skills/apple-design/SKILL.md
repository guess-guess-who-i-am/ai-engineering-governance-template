---
name: apple-design
description: Design or review fluid gesture-driven web interactions with immediate feedback, direct manipulation, interruptible motion, velocity handoff, spatial consistency, and reduced-motion behavior. Do not use for static pages without meaningful interaction.
---

# Apple Design Interaction Adapter

Load this only when interaction feel is part of the requirement.

## Core rules

1. Respond on pointer-down and keep feedback continuous during the gesture; remove non-essential latency from the input path.
2. Track direct manipulation 1:1 with the pointer, preserve the grab offset, and use Pointer Events with pointer capture when the interaction can leave the element.
3. Every gesture-driven animation must be interruptible. Animate from the current presented value, accept a new target immediately, and carry the user's velocity through reversal.
4. Use springs for touch-driven motion. Start with critically damped motion; use bounce only when the gesture carried momentum.
5. Hand off release velocity to the spring. Project a flick toward its likely resting position before selecting the nearest snap point.
6. Keep spatial relationships stable: enter and exit along the same path and anchor menus, sheets, and popovers to their source.
7. Use compositor-friendly properties such as `transform` and `opacity`; support `prefers-reduced-motion` with an intentional non-motion state.
8. Use translucent materials only to express hierarchy, preserve text contrast, and avoid stacking translucent surfaces that destroy legibility.

## Verification

Test pointer-down feedback, interruption during motion, release with velocity, keyboard operation, reduced motion, and narrow/wide viewports. A screenshot alone cannot prove interaction continuity.

## Source provenance

This is a compact project adapter based on the MIT-licensed Apple Design Skill:
https://github.com/emilkowalski/skills/tree/main/skills/apple-design

The full upstream mirror remains research material; this adapter is the routed project contract.
