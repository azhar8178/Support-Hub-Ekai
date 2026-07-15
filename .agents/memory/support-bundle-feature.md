---
name: Support bundle feature
description: Architecture decisions for the diagnostic bundle upload system (ZIP upload, parse, display).
---

## Key decisions

**Upload transport:** Multipart/form-data via multer (not base64 JSON). Bundle endpoint is `POST /tickets/:id/bundles` with field name `bundle`. Express body parser limit is irrelevant because multer intercepts before it.

**OpenAPI + codegen gotcha:** Adding a multipart/form-data POST to `lib/api-spec/openapi.yaml` causes orval to generate types that reference `File` and `Blob`. These are browser globals that are not in `lib/api-zod`'s tsconfig (`"lib": ["ES2020"]`, no DOM). The codegen typecheck fails. **Solution:** Remove the POST endpoint from the OpenAPI spec entirely; call the upload directly from the portal via `fetch` + `FormData`. Only list/download GET endpoints are in the spec.

**Portal upload pattern:** Use `fetch(\`\${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/tickets/\${id}/bundles\`, { method: 'POST', body: formData })`. Never block ticket creation if the bundle upload fails — warn with a toast instead.

**Storage:** Local filesystem at `artifacts/api-server/uploads/bundles/{ticketId}/{bundleId}-{filename}`. `process.cwd()` in the api-server is `artifacts/api-server`. For production, swap for S3/GCS.

**Ticket DTO augmentation:** `bundleCount` and `latestBundleStatus` added to `TicketDto`. Populated via a separate query in `loadBundleInfoMap()` — not a JOIN — to keep the serializer readable. Queries all bundles for the given ticket IDs in one round-trip then processes in JS.

**Why:**
- Removing POST from spec avoids the File/Blob tsconfig issue cleanly; the portal doesn't benefit from a generated hook for a multipart upload anyway.
- Local filesystem is simpler for self-hosted dev; the spec explicitly calls out production should use object storage.
- Separate bundle query (not JOIN) avoids complicating the main ticket query and is fast enough at current scale.
