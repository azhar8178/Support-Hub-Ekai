---
name: Local auth mode
description: How AUTH_MODE=local (password-based self-hosted auth) is wired — backend, frontend, bootstrap, and Docker.
---

## The rule
`AUTH_MODE` (env var, default `local`) switches the entire auth stack at runtime on the API and at build time on the portal (`VITE_AUTH_MODE`). The two values must match — mismatching breaks login.

## Backend (`AUTH_MODE=local`)
- `app.ts` dynamically imports `createSessionMiddleware` from `middlewares/localAuth.ts` and mounts it before routes. Clerk middleware is skipped entirely.
- `middlewares/localAuth.ts` — `express-session` + `connect-pg-simple` (session table auto-created). Requires `SESSION_SECRET` env var or throws at startup.
- `requireAuth.ts` dynamically imports `requireLocalAuth` from `localAuth.ts` and delegates to it.
- `routes/auth.ts` — `POST /api/auth/login` and `POST /api/auth/logout` only exist when `AUTH_MODE=local`. `POST /invites/accept` only exists in clerk mode.
- `routes/bootstrap.ts` — local mode self-gate uses `passwordHash IS NOT NULL`; creates user with bcrypt-hashed password, returns `initialPassword` in response + logs it.
- `passwordHash` column added to `usersTable` (nullable text).
- Packages added to api-server: `bcryptjs`, `express-session`, `connect-pg-simple` + their `@types/*`.

## Frontend (`VITE_AUTH_MODE=local`)
- `App.tsx` checks `import.meta.env.VITE_AUTH_MODE` at the top level (build-time constant).
- `local` → renders `LocalProviderWithRoutes` (no Clerk provider, no token getter).
- `clerk` → renders `ClerkProviderWithRoutes` (original behavior).
- Shared components (`AccessDenied`, `SessionProblem`, `AuthenticatedApp`) use `useAuthActions()` from `contexts/auth-context.tsx` for signOut — no direct `useClerk()` calls.
- `AuthActionProvider` wraps the tree in both modes with mode-specific signOut implementation.
- Local login page: `pages/auth/local-login.tsx` — email+password form, POSTs to `/api/auth/login` with `credentials: 'include'`, calls `onSuccess()` on 200.
- In local mode, `setAuthTokenGetter` is never called — cookies are sent automatically.

## Docker / config
- `docker-compose.yml` — `AUTH_MODE` defaults to `local`. `SESSION_SECRET` added. Clerk keys are optional (`:-` default). Portal build arg `VITE_AUTH_MODE: ${AUTH_MODE:-local}`.
- `.env.example` — `AUTH_MODE=local` default, Clerk keys blank.
- `scripts/check-env.sh` — branches on `AUTH_MODE`: requires `SESSION_SECRET` for local, `CLERK_*` for clerk.
- `artifacts/support-portal/Dockerfile` — added `VITE_AUTH_MODE` build arg (default `clerk`).

**Why:** User self-hosts on Ubuntu + Docker, doesn't want a Clerk account. Local mode uses cookie sessions (HttpOnly, secure in prod) backed by Postgres so sessions survive restarts.

**How to apply:** Any future auth-related change must work in both modes. The pattern is: branch on `AUTH_MODE` env var; lazy-import Clerk so it's not loaded in local mode.
