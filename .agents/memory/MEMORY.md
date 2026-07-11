# Memory Index

- [Attachment storage in App Storage](attachment-storage.md) — attachment bytes in object storage, DB keeps metadata + storage_key; authz stays in routes; drizzle push can't rename columns non-interactively.
- [Mobile/web design parity](mobile-web-parity.md) — mobile artifact mirrors portal tokens (navy #0F1F3D / blue #2563EB); sync from support-portal CSS, plus generated-hook gotchas.
- [Expo mobile artifact quirks](expo-mobile-quirks.md) — `npx expo install` silently no-ops in this pnpm workspace (use `pnpm add` + root install); SDK 54 file-system legacy API notes.
- [Stale TS project refs](stale-ts-project-refs.md) — phantom typecheck errors (missing exports/old shapes) mean stale lib dist; run `npx tsc -b lib/<pkg> --force` for every lib named in errors (incl. api-client-react), don't edit code.
- [React type package dedupe](react-types-dedupe.md) — keep one @types/react (19.1.x, expo's pin) via catalog + overrides; duplicates cause "unrelated Ref types" tsc errors.
- [Shared dev DB drift](shared-dev-db-drift.md) — parallel tasks share one dev Postgres; "column does not exist" or stale-dist "no exported member" failures may be sibling-task drift, not your change.
