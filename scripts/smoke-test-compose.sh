#!/usr/bin/env bash
# =============================================================================
# scripts/smoke-test-compose.sh
# =============================================================================
# Smoke-tests the Docker Compose stack on a clean database.
#
# What it does:
#   1. Builds all images and starts the stack (postgres, migrator, api-server).
#   2. Waits up to WAIT_SECS seconds for the API server's /api/healthz to
#      return HTTP 200.
#   3. Tears the stack down (and removes volumes) on exit — success or failure.
#
# Exit codes:
#   0  — migrator completed successfully AND api-server became healthy
#   1  — migrator failed, api-server never became healthy, or timed out
#
# Usage:
#   ./scripts/smoke-test-compose.sh
#
# Environment variables (all optional — defaults are safe for local testing):
#   POSTGRES_PASSWORD   Postgres password          (default: smoke-test-secret)
#   API_PORT            Host port for the API       (default: 18080, avoids
#                       conflicts with a running dev stack on 8080)
#   WAIT_SECS           Seconds to wait for health  (default: 120)
#   COMPOSE_PROJECT     docker compose project name (default: ekai-smoke)
#
# Note: CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are set to stub values by
# default. The /api/healthz endpoint does not require Clerk authentication, so
# the stack comes up healthy even with stub keys. Real keys are only needed
# when testing authenticated flows.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# All variables are exported so docker compose inherits them from the shell
# environment (Compose reads from the process env, not just .env files).
# ---------------------------------------------------------------------------
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-smoke-test-secret}"
export API_PORT="${API_PORT:-18080}"
export WAIT_SECS="${WAIT_SECS:-120}"
export COMPOSE_PROJECT="${COMPOSE_PROJECT:-ekai-smoke}"

# Stub Clerk keys — healthz does not require real auth
export CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-pk_test_smoke000000000000000000000000000000000000000000000000}"
export CLERK_SECRET_KEY="${CLERK_SECRET_KEY:-sk_test_smoke000000000000000000000000000000000000000000000000000}"
export PORTAL_URL="${PORTAL_URL:-http://localhost}"

# Prevent docker compose from picking up a local .env that might override
# the controlled defaults set above.
export COMPOSE_ENV_FILES=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[smoke-test] $*"; }
pass() { echo "[smoke-test] ✅ $*"; }
fail() { echo "[smoke-test] ❌ $*" >&2; exit 1; }

# Always tear down on exit (removes containers AND the ephemeral volume so the
# next run always starts with a clean database).
cleanup() {
  log "Tearing down stack (project: ${COMPOSE_PROJECT}) …"
  docker compose \
    --project-name "${COMPOSE_PROJECT}" \
    down --volumes --remove-orphans 2>/dev/null || true
  log "Teardown complete."
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Build images and bring up the stack (portal is excluded — we only need
#    the migrator and api-server for this test).
# ---------------------------------------------------------------------------
log "Building images and starting stack (project: ${COMPOSE_PROJECT}) …"

docker compose \
  --project-name "${COMPOSE_PROJECT}" \
  up --build --detach \
  --no-deps \
  postgres migrator api-server \
  --wait-timeout 30 \
  2>&1 | sed 's/^/  /' || true
# We don't rely on --wait here because the api-server healthcheck has a
# 30-second start_period; we poll manually below for clearer diagnostics.

# ---------------------------------------------------------------------------
# 2. Verify the migrator exited 0
# ---------------------------------------------------------------------------
log "Waiting for migrator to finish …"

MIGRATOR_CONTAINER=$(
  docker compose \
    --project-name "${COMPOSE_PROJECT}" \
    ps --quiet migrator 2>/dev/null | head -1
)

if [[ -z "${MIGRATOR_CONTAINER}" ]]; then
  fail "Could not find migrator container — did the build fail?"
fi

# docker wait blocks until the container exits, then prints its exit code.
MIGRATOR_EXIT=$(docker wait "${MIGRATOR_CONTAINER}" 2>/dev/null || echo "error")

if [[ "${MIGRATOR_EXIT}" != "0" ]]; then
  log "--- migrator logs ---"
  docker compose \
    --project-name "${COMPOSE_PROJECT}" \
    logs migrator 2>&1 | tail -40 | sed 's/^/  /'
  fail "Migrator exited with code ${MIGRATOR_EXIT}"
fi

pass "Migrator completed successfully (exit 0)."

# ---------------------------------------------------------------------------
# 3. Poll /api/healthz until it returns 200 or we time out
# ---------------------------------------------------------------------------
HEALTH_URL="http://localhost:${API_PORT}/api/healthz"
log "Polling ${HEALTH_URL} (up to ${WAIT_SECS}s) …"

ELAPSED=0
INTERVAL=5
HEALTHY=false

while [[ "${ELAPSED}" -lt "${WAIT_SECS}" ]]; do
  HTTP_STATUS=$(
    curl --silent --output /dev/null --write-out "%{http_code}" \
      --max-time 3 "${HEALTH_URL}" 2>/dev/null || echo "000"
  )

  if [[ "${HTTP_STATUS}" == "200" ]]; then
    HEALTHY=true
    break
  fi

  log "  (${ELAPSED}s) api-server not ready yet (HTTP ${HTTP_STATUS}) — retrying in ${INTERVAL}s …"
  sleep "${INTERVAL}"
  ELAPSED=$(( ELAPSED + INTERVAL ))
done

if [[ "${HEALTHY}" != "true" ]]; then
  log "--- api-server logs ---"
  docker compose \
    --project-name "${COMPOSE_PROJECT}" \
    logs api-server 2>&1 | tail -60 | sed 's/^/  /'
  fail "API server did not become healthy within ${WAIT_SECS}s."
fi

pass "API server is healthy after ~${ELAPSED}s (HTTP 200)."
pass "Smoke test passed."
