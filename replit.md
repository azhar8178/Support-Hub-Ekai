# Ekai Support Portal

## Overview
Customer support portal for Ekai.ai (B2B SaaS — semantic modeling layer for enterprise AI agents across AWS/Azure/GCP/Snowflake). Invite-only access with three roles: `customer`, `ekai_agent`, `admin`.

## Architecture
- **artifacts/api-server** — Express 5 API (port from `PORT`), Replit-managed Clerk auth via proxy middleware, Drizzle ORM.
- **artifacts/support-portal** — React + Vite frontend (wouter, TanStack Query, Tailwind, shadcn/ui), Clerk React.
- **lib/db** — Drizzle schema (orgs, users, invites, tickets + messages/attachments/status history, KB articles + feedback, SLA config, notifications).
- **lib/api-spec/openapi.yaml** — API contract; codegen produces `@workspace/api-zod` (zod schemas) and `@workspace/api-client-react` (TanStack Query hooks). Regenerate after spec changes.

## Key behaviors
- **Auth**: invite-only. Users are provisioned by invite; Clerk sign-in links to a portal user by `clerkUserId` or email. Non-invited Clerk users get 403 `not_invited`.
- **SLA**: P1 15min/4h (24x7); P2 60/480; P3 240/1440; P4 540/none (business hours 09:00–18:00 UTC Mon–Fri). SLA pauses on `awaiting_customer`, resumes and shifts deadlines on customer reply. 75% warning notifications via background sweep (60s interval).
- **Status flow**: new → triaged → in_progress → awaiting_customer → resolved → closed. Customer reply on awaiting_customer auto-moves to in_progress. Resolved auto-closes after 5 business days. Closed is read-only.
- **Notifications**: in-app rows in `notifications` table; email delivery is a pluggable `NotificationChannel` interface (`api-server/src/lib/notify.ts`) with a logging stub — swap in a real provider later.
- **Seed** (first boot, when users table is empty): admin@ekai.ai, support@ekai.ai, 2 customer orgs w/ 1 user each, 5 tickets, 3 KB articles, 1 pending demo invite (`demo-invite-token-priya`).

## Conventions
- Attachments stored base64 in Postgres (5MB cap per file).
- Backend zod validation uses generated `@workspace/api-zod` schemas; responses `parse`d before sending.
- Design: deep navy `#0F1F3D`, electric blue `#2563EB`, light grey `#F8FAFC` cards, Inter font. No emojis in UI.
- After backend changes: restart workflow `artifacts/api-server: API Server` (dev script builds with esbuild, then runs).

## User preferences
(none recorded yet)
