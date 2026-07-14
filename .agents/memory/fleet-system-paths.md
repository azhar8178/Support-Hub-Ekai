---
name: Fleet system paths
description: Fleet health monitoring routes, naming conventions, and schema decisions
---

## Route Paths
Fleet routes use `/admin/fleet/...` and `/fleet/...` prefixes — NOT `/admin/environments/...`.
The spec already had `/admin/environments` for the ticket taxonomy (environment dropdown values), so the fleet paths must be namespaced under `fleet/` to avoid a duplicate-path error in orval codegen.

**Authoritative path mapping:**
- `GET/POST /admin/fleet/environments` — register / list customer environments
- `DELETE /admin/fleet/environments/:id` — soft-delete
- `GET /admin/fleet/environments/:id/snapshots` — 7-day snapshot history
- `GET /admin/fleet/environments/:id/alerts` — per-env alerts
- `GET /admin/fleet/health-alerts` — all alerts
- `POST /admin/fleet/health-alerts/:id/acknowledge` — ack alert
- `GET /fleet/environments` — customer own-org view
- `GET /fleet/environments/:id/snapshots` — customer snapshot view
- `POST /fleet/heartbeat` — agent push (unauthenticated session-wise, uses X-Fleet-API-Key)
- `GET /fleet/check-heartbeats` — cron endpoint, requires X-Cron-Secret

## Token Format
`ek_fleet_<32 hex chars>` — prefix stored = first 12 chars (for fast DB filter + display).

## Auth Header
Heartbeat push: `X-Fleet-API-Key`. Cron: `X-Cron-Secret` matching `CRON_SECRET` env var.

## Status Values
`HEALTHY | DEGRADED | DOWN | OFFLINE | UNKNOWN`
- Missed heartbeat sets `OFFLINE` (not UNKNOWN).

## Auto-Ticket Schema Constraints
`raisedById` in `tickets` table is nullable — altered in DB and Drizzle schema to allow auto-created tickets with no human raiser. `authorId` in `ticket_messages` is also nullable for the same reason.

**Why:** Fleet monitoring auto-creates tickets when environments go DOWN/DEGRADED; there is no human who "raised" these tickets. Making both columns nullable was the correct fix rather than inventing a system user.

## heartbeatMode
Column `heartbeat_mode TEXT NOT NULL DEFAULT 'push'` on `customer_environments`. Values: `push` | `poll`. Only `push` envs receive heartbeats at the ingest endpoint. The registration UI defaults to `push` with a warning banner when `poll` is selected.
