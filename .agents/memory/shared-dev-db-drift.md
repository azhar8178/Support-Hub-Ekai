---
name: Shared dev DB drift across parallel tasks
description: Test failures can come from sibling tasks' schema drift, not your change; how to diagnose and fix.
---

Parallel task environments share one dev Postgres. When another in-flight task changes the Drizzle schema, your task's code can expect columns the DB doesn't have yet (or vice versa), making unrelated tests fail with `42703 column does not exist`.

**Why:** each task env has its own code snapshot but the same database; `drizzle-kit push` then hits interactive rename prompts it cannot answer without a TTY.

**How to apply:** when a test fails on an insert/select you didn't touch, compare `information_schema.columns` against the schema in `lib/db/src/schema/` before debugging your own change. Apply the missing DDL with direct SQL (rename/create), then run `drizzle-kit push` to confirm no remaining diff.
