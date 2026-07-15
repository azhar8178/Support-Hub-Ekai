# Memory Index

- [Support bundle feature](support-bundle-feature.md) — multipart upload via multer; OpenAPI multipart generates broken File/Blob types in api-zod so POST removed from spec; portal uploads directly via fetch+FormData.

- [Attachment storage in App Storage](attachment-storage.md) — attachment bytes in object storage, DB keeps metadata + storage_key; authz stays in routes; drizzle push can't rename columns non-interactively.
- [Mobile/web design parity](mobile-web-parity.md) — mobile mirrors portal tokens; sync from support-portal CSS (current brand in portal-theming.md), plus generated-hook gotchas.
- [Support portal theming](portal-theming.md) — re-brand needs token swap PLUS a sweep of 100+ hardcoded hexes/utility classes; brand=gold #EFB323 primary + navy #0F1F3D text; white-on-gold fails contrast.
- [Expo mobile artifact quirks](expo-mobile-quirks.md) — `npx expo install` silently no-ops in this pnpm workspace (use `pnpm add` + root install); SDK 54 file-system legacy API notes.
- [Stale TS project refs](stale-ts-project-refs.md) — phantom typecheck errors (missing exports/old shapes) mean stale lib dist; run `npx tsc -b lib/<pkg> --force` for every lib named in errors (incl. api-client-react), don't edit code.
- [React type package dedupe](react-types-dedupe.md) — keep one @types/react (19.1.x, expo's pin) via catalog + overrides; duplicates cause "unrelated Ref types" tsc errors.
- [pnpm hoist store staleness](pnpm-hoist-staleness.md) — "library class missing props/setState" tsc errors mean `.pnpm/node_modules/@types/react` is gone; `pnpm install --force` fixes (plain install no-ops).
- [Validation commands are workflows](validation-vs-workflows.md) — register checks via setValidationCommand only; a same-named plain workflow blocks it (NO_MATCHING_WORKFLOW).
- [Shared dev DB drift](shared-dev-db-drift.md) — parallel tasks share one dev Postgres; "column does not exist" or stale-dist "no exported member" failures may be sibling-task drift, not your change.
- [Taxonomy as data](taxonomy-as-data.md) — severity/category/environment are admin-editable rows (severities live on sla_config); retire not delete, validate at runtime, keep retired in SLA cache but filter active for top-rank.
- [Local auth mode](local-auth-mode.md) — AUTH_MODE=local adds password+session auth; VITE_AUTH_MODE build arg must match; both must be set together or login breaks.
- [Health telemetry system](health-telemetry-system.md) — API key auth, rate-limit, operationId naming rules, looseObject/zod v3 fix, query options pattern for new env health feature.
- [Fleet system paths](fleet-system-paths.md) — fleet routes live under /admin/fleet/... and /fleet/... (not /admin/environments) to avoid taxonomy collision; token format ek_fleet_; raisedById is nullable for auto-created tickets.
