#!/usr/bin/env bash
# =============================================================================
# check-env.sh — Validate required environment variables before Docker Compose
# =============================================================================
# Usage:
#   ./scripts/check-env.sh            # checks current environment
#   source .env && ./scripts/check-env.sh
#   # or with a .env file:
#   set -a; source .env; set +a; ./scripts/check-env.sh
#
# Exit codes:
#   0  — all required variables are set and non-empty
#   1  — one or more required variables are missing
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

# -----------------------------------------------------------------------------
# Required variables — the stack will not work without these
# -----------------------------------------------------------------------------
REQUIRED_VARS=(
  "POSTGRES_PASSWORD"
  "CLERK_PUBLISHABLE_KEY"
  "CLERK_SECRET_KEY"
  "PORTAL_URL"
)

# -----------------------------------------------------------------------------
# Check each required variable
# -----------------------------------------------------------------------------
missing=()

for var in "${REQUIRED_VARS[@]}"; do
  value="${!var:-}"
  if [[ -z "$value" ]]; then
    missing+=("$var")
  fi
done

# -----------------------------------------------------------------------------
# Report results
# -----------------------------------------------------------------------------
if [[ ${#missing[@]} -eq 0 ]]; then
  echo -e "${GREEN}✓ All required environment variables are set.${RESET}"
  exit 0
fi

echo -e "${RED}${BOLD}ERROR: Missing required environment variables${RESET}"
echo -e "${RED}──────────────────────────────────────────────${RESET}"
for var in "${missing[@]}"; do
  echo -e "  ${RED}✗ ${var}${RESET} is not set or is empty"
done
echo ""
echo -e "${YELLOW}${BOLD}How to fix:${RESET}"
echo -e "  1. Copy the example file if you haven't already:"
echo -e "       ${BOLD}cp .env.example .env${RESET}"
echo -e "  2. Open ${BOLD}.env${RESET} and fill in the missing values:"
for var in "${missing[@]}"; do
  case "$var" in
    POSTGRES_PASSWORD)
      echo -e "       ${BOLD}POSTGRES_PASSWORD${RESET} — choose a strong password for the database"
      ;;
    CLERK_PUBLISHABLE_KEY)
      echo -e "       ${BOLD}CLERK_PUBLISHABLE_KEY${RESET} — from https://dashboard.clerk.com → API Keys (pk_live_… or pk_test_…)"
      ;;
    CLERK_SECRET_KEY)
      echo -e "       ${BOLD}CLERK_SECRET_KEY${RESET} — from https://dashboard.clerk.com → API Keys (sk_live_… or sk_test_…)"
      ;;
    PORTAL_URL)
      echo -e "       ${BOLD}PORTAL_URL${RESET} — publicly reachable URL of the support portal, e.g. https://support.yourcompany.com"
      ;;
    *)
      echo -e "       ${BOLD}${var}${RESET}"
      ;;
  esac
done
echo -e "  3. Re-run this check:"
echo -e "       ${BOLD}set -a; source .env; set +a; ./scripts/check-env.sh${RESET}"
echo -e "  4. Then start the stack:"
echo -e "       ${BOLD}docker compose up -d --build${RESET}"
echo ""
exit 1
