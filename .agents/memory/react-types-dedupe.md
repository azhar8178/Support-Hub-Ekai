---
name: React type package dedupe
description: Why @types/react must stay on one version (19.1.x) workspace-wide
---

# React type package dedupe

Rule: keep exactly one `@types/react` / `@types/react-dom` version across the pnpm workspace, on the 19.1.x line.

**Why:** The Expo mobile artifact pins `@types/react` `~19.1.10` (SDK 54 requirement), while the catalog once pointed at `^19.2.0`. Two installed versions made structurally identical `Ref<T>` types "unrelated" (the `VoidOrUndefinedOnly` brand differs per copy), breaking `tsc --noEmit` in support-portal with confusing errors in innocent UI components (calendar, spinner).

**How to apply:** Both the catalog entries and the `overrides` block in `pnpm-workspace.yaml` pin `@types/react: ~19.1.10` and `@types/react-dom: ~19.1.7`. If a "two different types with this name exist, but they are unrelated" error mentions `@types/react`, check `ls node_modules/.pnpm | grep '@types+react@'` for duplicates before touching component code. Don't bump the catalog to 19.2+ unless Expo's pin moves too.

## Related failure: missing private-hoist @types/react

Symptom: mobile `tsc` errors like `Property 'children' does not exist on ... GestureHandlerRootViewProps` (or other RN lib props losing members) even though the lockfile has only one `@types/react` copy. Root cause: `node_modules/.pnpm/node_modules/@types/react` (pnpm's private hoist dir) was missing (orphaned 19.2.x dirs can linger in `.pnpm` after sibling merges), so `import 'react'` inside third-party d.ts files (which lack an `@types/react` peer symlink, e.g. react-native-gesture-handler) resolved to the untyped `react/index.js`, making `PropsWithChildren` a no-op and prop types collapse.

**How to apply:** on "unrelated Ref types"/"children does not exist" errors, check `readlink node_modules/.pnpm/node_modules/@types/react` before touching component code; `tsc --traceResolution` confirms 'react' resolving to `react/index.js` instead of `@types/react`. Fix: `pnpm install --force` rebuilds the hoist dir; a plain `pnpm install` does NOT repair it.
