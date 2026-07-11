---
name: pnpm hidden hoist store staleness
description: tsc errors like "class missing props/setState/context" from library components (e.g. recharts) when .pnpm/node_modules lacks @types/react
---

# pnpm hidden hoist store staleness

**Rule:** If tsc reports library class components (recharts XAxis/Line/Tooltip, etc.) "cannot be used as a JSX component" / "missing context, setState, forceUpdate, props", check `node_modules/.pnpm/node_modules/@types/react`. If it's missing, run `pnpm install --force` at the workspace root — a plain `pnpm install` no-ops and does NOT rebuild the hidden hoist store.

**Why:** Third-party .d.ts files resolve `react` by walking up to pnpm's hidden hoist store (`node_modules/.pnpm/node_modules`). When that store is stale/pruned (e.g. by parallel sibling tasks touching node_modules), the library's `react` import resolves to untyped `react/index.js`, making every class component look untyped. `--explainFiles` misleadingly shows only one @types/react in the program.

**How to apply:** Before editing app code to "fix" such errors, verify the hoist store. Orphaned `.pnpm/@types+react@<other-version>` dirs not present in the lockfile are harmless leftovers.
