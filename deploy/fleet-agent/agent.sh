#!/bin/sh
# =============================================================================
# Ekai Fleet Agent
# =============================================================================
# Polls the local Ekai API health endpoint and forwards the result to the
# Ekai support portal as a fleet heartbeat.
#
# Required environment variables:
#   FLEET_HUB_URL   – support portal base URL (e.g. https://dev.ekai.ai)
#   FLEET_API_KEY   – per-environment API key from Admin → Environments
#   EKAI_HEALTH_URL – internal URL of the Ekai API healthz endpoint
#                     (e.g. http://ekai-api:8080/api/healthz)
# =============================================================================

set -eu

: "${FLEET_HUB_URL:?FLEET_HUB_URL is required}"
: "${FLEET_API_KEY:?FLEET_API_KEY is required}"
: "${EKAI_HEALTH_URL:?EKAI_HEALTH_URL is required}"

HUB_ENDPOINT="${FLEET_HUB_URL%/}/api/fleet/heartbeat"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

# ---------------------------------------------------------------------------
# 1. Fetch local health
# ---------------------------------------------------------------------------
HEALTH_JSON="$(curl -sf --max-time 10 "${EKAI_HEALTH_URL}" 2>/dev/null || echo '')"

if [ -z "${HEALTH_JSON}" ]; then
  echo "[fleet-agent] WARNING: could not reach ${EKAI_HEALTH_URL} — reporting degraded"
  STATUS="degraded"
  DB_STATUS="degraded"
  DB_LATENCY=0
  OPEN_TICKETS=0
  SLA_BREACHES=0
else
  STATUS="$(echo "${HEALTH_JSON}"       | jq -r '.status       // "degraded"')"
  DB_STATUS="$(echo "${HEALTH_JSON}"    | jq -r '.db.status    // "degraded"')"
  DB_LATENCY="$(echo "${HEALTH_JSON}"   | jq -r '.db.latencyMs // 0')"
  OPEN_TICKETS="$(echo "${HEALTH_JSON}" | jq -r '.openTicketCount // 0')"
  SLA_BREACHES="$(echo "${HEALTH_JSON}" | jq -r '.slaBreachCount  // 0')"
fi

# ---------------------------------------------------------------------------
# 2. Build heartbeat payload
# ---------------------------------------------------------------------------
PAYLOAD="$(cat <<EOF
{
  "timestamp": "${TIMESTAMP}",
  "status": "${STATUS}",
  "version": "fleet-agent/1.0",
  "services": [
    {
      "name": "db",
      "type": "database",
      "status": "${DB_STATUS}",
      "latency_ms": ${DB_LATENCY},
      "error_rate_percent": 0,
      "uptime_seconds": 0
    }
  ],
  "platform": {
    "openTicketCount": ${OPEN_TICKETS},
    "slaBreachCount":  ${SLA_BREACHES}
  }
}
EOF
)"

# ---------------------------------------------------------------------------
# 3. Send heartbeat
# ---------------------------------------------------------------------------
HTTP_STATUS="$(curl -sf --max-time 10 \
  -o /dev/null -w "%{http_code}" \
  -X POST "${HUB_ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "X-Fleet-API-Key: ${FLEET_API_KEY}" \
  -d "${PAYLOAD}" 2>/dev/null || echo "000")"

if [ "${HTTP_STATUS}" = "200" ]; then
  echo "[fleet-agent] heartbeat sent — status=${STATUS}"
else
  echo "[fleet-agent] ERROR: hub returned HTTP ${HTTP_STATUS}" >&2
  exit 1
fi
