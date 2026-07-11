---
name: Shared dev DB drift across parallel tasks
description: Test failures can come from sibling tasks' schema drift, not your change; how to diagnose and fix.
---

Parallel task environments share one dev Postgres. When another in-flight task changes the Drizzle schema, your task's code can expect columns the DB doesn't have yet (or vice versa), making unrelated tests fail with `42703 column does not exist`.

**Why:** each task env has its own code snapshot but the same database; `drizzle-kit push` then hits interactive rename prompts it cannot answer without a TTY.

**How to apply:** when a test fails on a table/column you didn't touch, suspect sibling-task drift before debugging your own change; re-sync the DB to `lib/db/src/schema/` (plain `drizzle-kit push` for additive changes; direct SQL only for renames it can't answer non-interactively).

Related: stale TypeScript project-reference output causes the same class of phantom failure — `typecheck` reports "no exported member" for symbols that exist in `src/` because `lib/*/dist` `.d.ts` predates a sibling task's merge. Fix with `tsc -b lib/db lib/api-zod --force` before assuming code is broken.
