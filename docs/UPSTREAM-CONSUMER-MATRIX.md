# Upstream Consumer Matrix

This matrix records how an upstream idea is actually consumed by this template. A mirror or URL alone is not an integration.

| Source | Routed consumer | Runtime action | Verification |
|---|---|---|---|
| awesome-design-md / getdesign | `build-designed-interface` | `scripts/route-design-references.ps1` searches at most five catalog entries; `install-design-reference.ps1` installs one pinned artifact with provenance | `scripts/test-design-references.ps1` |
| Taste Skill | `design-taste-frontend` | Load only for landing pages, portfolios, and redesigns; use Design Read, three local dials, and anti-default checks | `scripts/test-skill-validation.ps1`; forward-test in the target UI |
| Apple Design Skill | `apple-design` | Load only for gesture, spring, latency, spatial continuity, or materials work; verify interruption and reduced motion | `scripts/test-skill-validation.ps1`; browser interaction evidence |
| Kest | `.kest/flow/*.flow.md` plus `scripts/run-kest-flow.ps1` | Contract is checked on every PR; real execution is explicit and low-frequency because the pinned CLI license is not redistributed | `scripts/test-kest-flow-contract.ps1`; `scripts/run-kest-flow.ps1` when `KEST_BIN` is supplied |
| LUAS | local engineering Skills | Adopted ideas are split into domain, contracts, debugging, TDD, verification, project start, and release/documentation workflows | `scripts/test-skill-validation.ps1`, project gate tests, and each Skill's forward-test |

The absence of a runtime action is intentional only when the source cannot be safely or legally redistributed. In that case the matrix must name the manual trigger and the evidence it produces.
