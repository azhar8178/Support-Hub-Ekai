---
name: Expo mobile artifact quirks
description: Package install and file-API gotchas for the Expo (SDK 54) mobile artifact in this pnpm workspace.
---

- `npx expo install <pkg>` inside `artifacts/mobile` silently fails to update package.json in this pnpm workspace. Use `pnpm add <pkg>@<sdk-compatible-version>` from the artifact dir instead (check Expo SDK 54 compatible versions first).

**Why:** expo install shells out to npm here and its writes don't land; the deps never appear, and the failure is silent (exit 0).

**How to apply:** after any expo package install, grep package.json to confirm the dep landed, then run `pnpm install` at the repo root — a filtered add can leave sibling packages' binaries (e.g. vitest in api-server) unlinked.

- Expo SDK 54's `expo-file-system` default export is the new class-based API; the stable `readAsStringAsync`/`writeAsStringAsync` live in `expo-file-system/legacy`. Web builds bundle the legacy import fine, but gate actual FS calls to native (`Platform.OS !== 'web'`) and use fetch+FileReader/Blob paths on web.
