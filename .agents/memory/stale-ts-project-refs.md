---
name: Stale TS project-reference outputs
description: Phantom typecheck errors (missing exports, old schema shapes) caused by stale lib dist/.d.ts; fix with tsc -b --force.
---

# Stale TypeScript project-reference outputs

**Rule:** If `pnpm --filter @workspace/api-server run typecheck` (or another artifact's typecheck) reports missing exports from `@workspace/db` / `@workspace/api-zod` or types matching an *old* schema shape — while runtime tests pass — the lib's compiled declarations are stale, not the code.

**Why:** Artifact tsconfigs use project references to `lib/db` and `lib/api-zod`, and their `typecheck` scripts run `tsc -p --noEmit`, which consumes the libs' `dist/*.d.ts` without rebuilding them. Sibling tasks that change lib source leave the dist output behind.

**How to apply:** From the workspace root run `npx tsc -b lib/db lib/api-zod --force`, then re-run the artifact typecheck. Don't "fix" imports or schemas based on the phantom errors.

**Red herring (July 2026):** Duplicate-`@types/react`-looking errors (e.g. "GestureHandlerRootViewProps has no children", "recharts Line is not a valid JSX component") can also be caused by stale root `*.tsbuildinfo` files even when the lockfile has only one @types/react — orphaned `@types+react@19.2.x` dirs in `.pnpm` are harmless leftovers. Fix: `find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete` then `npx tsc -b lib/... --force`; don't chase the .pnpm store.

**Mitigations in place (July 2026):** api-server and mobile `typecheck` scripts now run `tsc -b` on their referenced libs before `tsc -p --noEmit`, so they self-heal; `api-spec` codegen also force-rebuilds `lib/api-client-react` (its `build` script) before `typecheck:libs`. Other artifacts' typecheck scripts may still hit this — apply the same prefix pattern if they do. Runtime is unaffected either way: lib package `exports` point at `src/*.ts`, so only declaration-consuming typechecks see stale dist.
