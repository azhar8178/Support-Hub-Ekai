---
name: React type package dedupe
description: Why @types/react must stay on one version (19.1.x) workspace-wide
---

# React type package dedupe

Rule: keep exactly one `@types/react` / `@types/react-dom` version across the pnpm workspace, on the 19.1.x line.

**Why:** The Expo mobile artifact pins `@types/react` `~19.1.10` (SDK 54 requirement), while the catalog once pointed at `^19.2.0`. Two installed versions made structurally identical `Ref<T>` types "unrelated" (the `VoidOrUndefinedOnly` brand differs per copy), breaking `tsc --noEmit` in support-portal with confusing errors in innocent UI components (calendar, spinner).

**How to apply:** Both the catalog entries and the `overrides` block in `pnpm-workspace.yaml` pin `@types/react: ~19.1.10` and `@types/react-dom: ~19.1.7`. If a "two different types with this name exist, but they are unrelated" error mentions `@types/react`, check `ls node_modules/.pnpm | grep '@types+react@'` for duplicates before touching component code. Don't bump the catalog to 19.2+ unless Expo's pin moves too.
