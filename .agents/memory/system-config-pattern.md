---
name: System config DB pattern
description: How runtime non-sensitive config is stored in DB with env var fallback, and the async cascade it creates.
---

# Runtime system config pattern

## The rule
Non-sensitive runtime config (URLs, sender address, region names, log level) lives in `site_settings` columns and is read via `artifacts/api-server/src/lib/systemConfig.ts`. Sensitive credentials (AWS keys, fleet API key) stay as env vars only.

**Why:** Admins can change operational config without a redeploy. Secrets never touch the DB.

## How to apply
- `systemConfig.ts` has a 60-second in-memory cache; call `invalidateSystemConfigCache()` after any PATCH to `site_settings`.
- All accessors (`getEmailFrom`, `getAwsRegion`, `getFleetHubUrl`, `getPrivateObjectDir`, `getPortalUrl`, `getLogLevel`) are **async** — DB value wins, env var is the fallback.
- This async pattern cascades: `email.ts` template functions are async, `getSesClient()` is async, `objectStorage.ts`'s `fileForStorageKey()` is async. Any future callers of these must `await` them.
- `notify.ts` calls email templates with `await templateFn(…)` then `await sendEmail(…)`.
- `admin.ts` calls `inviteEmail` with `await inviteEmail(…)`.

## DB columns added to site_settings
`email_from`, `aws_region`, `fleet_hub_url`, `private_object_dir`, `portal_url`, `log_level` — all nullable text, DB value overrides env var when non-null/non-empty.

## OpenAPI / codegen
New fields added to `SiteSettings` (response) and `SiteSettingsUpdate` (request body) in `lib/api-spec/openapi.yaml`. Run `pnpm --filter @workspace/api-spec run codegen` after any spec change to regenerate `lib/api-zod` and `lib/api-client-react`.
