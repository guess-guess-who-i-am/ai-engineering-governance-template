# Evidence ladder

Prefer the lowest level that directly reaches the changed consumer, and combine levels when boundaries differ.

1. Static structure: schema, lint, type, dependency or policy checks.
2. Unit behavior: isolated domain or transformation logic.
3. Integration behavior: real adapters, database, filesystem, or framework boundary.
4. Contract behavior: producer and consumer agree on public shape and failure semantics.
5. End-to-end behavior: a real user or system journey reaches the intended outcome.
6. Operational behavior: security, performance, reliability, migration, deployment, or recovery evidence when affected.
7. Qualitative behavior: blinded review of taste, intent, clarity, or tone after measurable correctness passes.

Do not substitute a lower level for a higher-level claim. A passing type check cannot prove a user journey works.

