---
name: review-data-migration
description: Review a durable-data migration for compatibility, locks, backfill, index strategy, deployment order, rollback, and recovery. Use before merging or deploying schema, constraint, index, type, or meaning changes. Do not use for synthetic seed-only changes.
---

# Review Data Migration

## Workflow

1. Read the migration, old and new models, all changed-field consumers, real engine/version, representative row counts, traffic shape, and deployment order.
2. Check whether old code can run on the expanded schema and new code can tolerate old rows during rollout.
3. Use expand/migrate/contract for renames, removals, type changes, or semantic changes. Do not add, backfill, and drop in one unsafe step.
4. Evaluate table rewrites, locks, transaction/log growth, replication, disk, and online-index behavior at real scale.
5. Make backfills bounded, batched, idempotent, resumable, observable, and throttleable.
6. Validate existing rows before enforcing stricter null, foreign-key, enum, uniqueness, or check constraints.
7. Prefer application rollback without destructive schema rollback. When data may be lost, require a tested backup/export and restore route.
8. Write the exact order for configuration, migration, old/new application, workers, consumers, cleanup, and feature activation.
9. Test forward, recovery or rollback, reapply, old/new compatibility, representative scale, and affected contract/Flow behavior.

Report findings as `block`, `fix-before-deploy`, or `follow-up`, with the failing scenario and smallest correction. An empty local database is not sufficient evidence.

## User Request - Original Wording Translated Into English

> "There are development standards summarized by other colleagues in this directory. Review them and take their strengths to supplement our system."
