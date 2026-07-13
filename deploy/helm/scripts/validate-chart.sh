#!/usr/bin/env bash
# validate-chart.sh — lint and template-render the ekai Helm chart
# Runs helm lint, then helm template with minimal overrides, and asserts
# that every required resource kind is present in the rendered output.
set -euo pipefail

HELM="${HELM_BIN:-/tmp/linux-amd64/helm}"
CHART="deploy/helm/ekai"
RELEASE="ekai-ci"

# ── Install Helm if not present ───────────────────────────────────────────────
if ! "$HELM" version --short &>/dev/null 2>&1; then
  echo "Helm not found at $HELM — downloading v3.15.0…"
  curl -fsSL https://get.helm.sh/helm-v3.15.0-linux-amd64.tar.gz \
    -o /tmp/helm.tar.gz
  tar -xzf /tmp/helm.tar.gz -C /tmp
  HELM="/tmp/linux-amd64/helm"
fi

echo "==> Helm version: $($HELM version --short)"

# ── 1. helm lint ─────────────────────────────────────────────────────────────
echo ""
echo "==> helm lint $CHART"
"$HELM" lint "$CHART" --strict
echo "    PASS: lint"

# ── 2. helm template ─────────────────────────────────────────────────────────
# Minimal override values used purely for CI; nothing sensitive is provided.
CI_VALUES=$(cat <<'EOF'
api:
  image:
    repository: example.com/ekai-api
    tag: ci
  secrets:
    CLERK_PUBLISHABLE_KEY: "pk_test_placeholder"
    CLERK_SECRET_KEY: "sk_test_placeholder"
    DATABASE_URL: "postgres://user:pass@localhost:5432/ekai"
portal:
  image:
    repository: example.com/ekai-portal
    tag: ci
ingress:
  host: ci.example.com
EOF
)

TMPVALS=$(mktemp /tmp/ekai-ci-values.XXXXXX.yaml)
echo "$CI_VALUES" > "$TMPVALS"
trap 'rm -f "$TMPVALS"' EXIT

echo ""
echo "==> helm template $RELEASE $CHART"
RENDERED=$("$HELM" template "$RELEASE" "$CHART" -f "$TMPVALS")
echo "$RENDERED"

# ── 3. Assert required resource kinds ────────────────────────────────────────
echo ""
echo "==> Checking required resource kinds…"

REQUIRED_KINDS=("Deployment" "Service" "Ingress" "HorizontalPodAutoscaler")
MISSING=()

for kind in "${REQUIRED_KINDS[@]}"; do
  if echo "$RENDERED" | grep -q "^kind: $kind"; then
    echo "    FOUND: $kind"
  else
    echo "    MISSING: $kind"
    MISSING+=("$kind")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  echo "ERROR: The following required resource kinds were not rendered:"
  for k in "${MISSING[@]}"; do echo "  - $k"; done
  exit 1
fi

echo ""
echo "All checks passed."
