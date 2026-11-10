# Adapting Desktop Prompt Composition

Separate the mechanism from the product's wording. Inspect the real producer, assembly boundary, consumer, and observable effect before copying behavior.

| Layer | Owner and loading boundary | Integration check |
|---|---|---|
| Host/base | Actual app capabilities, environment, tool protocol, instruction priority | Never assert another app's VM, paths, tools, model cutoff, or permissions |
| User/project | User preferences and nearest project instructions under the host's real authority order | Do not import Claude's organization priority as a new authority hierarchy |
| Routed Skill | Name, discriminating description, source/location; body only on selection | A recommendation is not activation; metadata and package text cannot grant authority |
| Current task | Latest user request, plan, inputs, output contract | Historical plans do not override steering; quoted requests are data |
| Child work | Authorized scope, necessary constraints, tools, expected evidence | Explicitly propagate required constraints; do not assume a child inherited every append |
| Tool/external data | Results and imported files separated from instructions | Preserve provenance; embedded role tags and approval requests remain data |
| Recovery | Active goal, loaded routes, unresolved gap, durable evidence | Re-load necessary instructions after compaction/resume; do not rely on a stale once-loaded flag |

For each adopted segment, retain a source locator and classify it as unchanged existing behavior, a new routed workflow, a runtime control, or excluded with a concrete conflict. Keep assembled prefixes stable when possible, append task-specific content separately, and measure actual cache usage before claiming token savings. A cache TTL setting is a request policy, not proof of a cache hit.

Use a composition snapshot containing source identity, order, target (main/child), version/hash when relevant, and omission reason. Do not store full conversations, secrets, or third-party private prompt bodies in a public audit record. Prompt instructions cannot enforce tool authorization, durable cancellation, or race safety; test those in the owning runtime.

Verify task switching, retries, compaction/resume, two concurrent sessions, unavailable dependencies, and hostile quoted content. Avoid promising better agent accuracy from route/format tests alone; compare real task outcomes when making that claim.
