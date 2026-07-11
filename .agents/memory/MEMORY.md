# Memory Index

- [Attachment storage in App Storage](attachment-storage.md) — attachment bytes in object storage, DB keeps metadata + storage_key; authz stays in routes; drizzle push can't rename columns non-interactively.
- [Mobile/web design parity](mobile-web-parity.md) — mobile artifact mirrors portal tokens (navy #0F1F3D / blue #2563EB); sync from support-portal CSS, plus generated-hook gotchas.
- [Expo mobile artifact quirks](expo-mobile-quirks.md) — `npx expo install` silently no-ops in this pnpm workspace (use `pnpm add` + root install); SDK 54 file-system legacy API notes.
- [Stale TS project refs](stale-ts-project-refs.md) — phantom typecheck errors (missing exports/old shapes) mean stale lib dist; run `npx tsc -b lib/db lib/api-zod --force`, don't edit code.
- [Shared dev DB drift](shared-dev-db-drift.md) — parallel tasks share one dev Postgres; "column does not exist" test failures may be sibling-task schema drift, fix via direct SQL then push.
