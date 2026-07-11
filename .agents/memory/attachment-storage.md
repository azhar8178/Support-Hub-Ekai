---
name: Attachment storage in App Storage
description: Ticket attachment bytes live in object storage, not Postgres; API contract stays base64.
---

Ticket attachment bytes are stored in Replit App Storage under `PRIVATE_OBJECT_DIR` with keys like `attachments/<ticketId>/<uuid>`; the DB row keeps only metadata + `storage_key`.

**Why:** base64 blobs in Postgres bloat the DB and slow queries. The upload/download API deliberately kept its base64 JSON contract so the web frontend and authz tests needed no changes — authorization (org scoping, internal-note hiding) is enforced in the route via DB checks, not object ACLs.

**How to apply:** any new attachment surface (mobile, deletion, larger files) must go through the storage helpers in the API server's `lib/objectStorage.ts` and keep the DB-side authz checks on download. Test fixtures upload real bytes to storage and delete them in cleanup.

Also: `drizzle-kit push` cannot resolve column renames non-interactively (no TTY) — apply such DDL with direct SQL, then run `push` to confirm no diff. Rebuild `lib/db` (`tsc -b lib/db`) after schema type changes or dependents typecheck against stale dist.
