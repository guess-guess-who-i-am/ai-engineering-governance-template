---
name: design-data-boundary
description: Design authoritative data ownership, schema, query, index, lifecycle, concurrency, and migration boundaries for new or changed durable data. Use when a Story changes database or persistent-data shape. Do not use merely to run an already-defined migration.
---

# Design Data Boundary

## Workflow

1. Read the owning entity, relationship, lifecycle, Story, contract, and real database engine/version.
2. Assign one owner for every write and business invariant. Other components consume contracts rather than sharing mutable tables.
3. Define stable identity, required and optional fields, types, uniqueness, relationships, retention, deletion, recovery, and audit needs.
4. Define each real query with filters, deterministic ordering, pagination, maximum result or scan size, and expected scale.
5. Derive indexes from those queries, uniqueness, tenant isolation, and write cost. Do not add soft delete or indexes by reflex.
6. Define transaction ownership, concurrency conflicts, lock order, optimistic versions, idempotency, retries, and partial-failure behavior.
7. Keep JSON and blobs bounded and validated; do not hide searchable core facts in opaque payloads.
8. Specify expand/migrate/contract steps, backfill, compatibility, and recovery before implementation.
9. Verify behavior on the project's actual engine. For performance-sensitive paths, capture a query plan or comparable benchmark at representative scale.

Output the ownership, schema/invariants, query-index matrix, concurrency policy, lifecycle, migration route, and evidence plan.

## User Request - Original Wording Translated Into English

> "There are development standards summarized by other colleagues in this directory. Review them and take their strengths to supplement our system."
