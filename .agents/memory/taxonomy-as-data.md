---
name: Ticket taxonomy as data (severities/categories/environments)
description: How the ticket taxonomy was de-hardcoded into admin-editable DB rows, and the invariants to preserve.
---

# Ticket taxonomy is data, not enums

Ticket `severity`, `category`, and `environment` are plain `text` columns (no `$type` enum unions) backed by admin-editable config tables. Categories/environments live in their own tables; **severities live in `sla_config`**, which is now the single source of truth for both SLA targets AND severity metadata (label, rank, isUrgent, resolutionOptional, active).

**Why:** admins need add/rename/retire without a migration or code deploy. Keeping severity metadata on `sla_config` avoids a second table that would have to stay in lockstep with SLA rows.

**How to apply / invariants:**
- Never reintroduce enum types for these three fields — validation is runtime, against *active* config rows (`validateTicketTaxonomy` in `api-server/src/lib/ticketConfig.ts`), enforced on ticket create.
- **Retire = `active:false`, never delete.** Existing tickets keep retired keys; UIs must fall back to rendering the raw key when a stored key isn't in the active list, or old tickets show blank.
- The in-memory severity cache (`severityMetaByKey` in `sla.ts`) must hold **all** severities (retired included) so SLA/urgency math resolves for old tickets — but any "what's the top/most-severe severity now" helper (e.g. `getTopSeverityRank`) must filter to `active`, or retiring the top severity silently breaks dashboard "P1 open" counts.
- Any severity create/update must call `refreshSlaClockCache()` afterward or the cache goes stale.
- De-hardcoded checks replaced literal `P1||P2`/`P4` logic: urgent-alert uses `isUrgentSeverity`, resolution-optional uses `isResolutionOptional`, top-severity uses rank getters. Don't hardcode severity keys again.
- Config keys are slugified from the label with in-process collision suffixing; inserts still wrap unique-violation (`23505`) → 409 for concurrency.

Public read: `GET /ticket-config` (any authed user) returns active options for forms/filters. Admin CRUD under `/admin/{categories,environments,severities}` (GET staff-readable, writes admin-only).
