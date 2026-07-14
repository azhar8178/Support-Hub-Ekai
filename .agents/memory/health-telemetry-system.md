---
name: Customer Health Telemetry System
description: Architecture notes for the health telemetry feature added to the Ekai Support Portal
---

## Tables
- `customer_environments` — per-org registered envs; API key stored as bcrypt hash + 16-char display prefix
- `health_snapshots` — one row per agent push; services/platform stored as JSON strings (TEXT columns)
- `health_alerts` — STATUS_CHANGE | MISSED_HEARTBEAT; links to auto-created ticket

## API key format
`ek_live_` + 32 random hex chars (16 random bytes). Display prefix = first 16 chars of full key.
Generated with `randomBytes(16).toString("hex")`.

## operationId collision
`createEnvironment` would clash with the existing taxonomy "environment" hook (`useCreateEnvironment`).
Named it `registerCustomerEnvironment` → hook `useRegisterCustomerEnvironment`.

## zod.looseObject crash (pre-existing + resolved)
Orval v8 generates `z.looseObject()` for `type: object` / `additionalProperties: true` schemas.
This is a zod v4 API and doesn't exist in zod v3 (the workspace pin).
**Fix:** remove bare `type: object` properties from OpenAPI schemas — define concrete properties or omit entirely.
Any remaining looseObject calls in api-zod must be patched post-codegen.

## Query option typing
Orval-generated hooks (React Query v5) require `queryKey` inside the `query` option.
Use `useEffect` + `refetch()` + `setInterval` for auto-refresh instead of passing `{ query: { refetchInterval } }`.

## Telemetry auth
`POST /api/telemetry/ingest` uses X-Ekai-API-Key header only — NO session middleware.
Rate limit: in-memory Map, 60s per environmentId.
Timestamp drift check: ±10 min.
Candidate lookup by orgId first (limits bcrypt compares to that org's envs).

## Email
All health alert emails go to `support@ekai.ai` (hardcoded per spec).
Fired fire-and-forget (`.catch(logger.error)`).

## Python agent
Located at `agent/health-agent.py`. Dependencies: `requests` (HTTP), `psutil` (system metrics).
Both optional — degrades gracefully. Loops every `EKAI_PUSH_INTERVAL` seconds (default 300).
