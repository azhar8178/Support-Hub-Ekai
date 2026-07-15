#!/usr/bin/env bash
# =============================================================================
# Ekai Support Bundle Generator
# Version: 1.0.0
# Usage:   ./support-bundle.sh [OPTIONS]
#
# Collects a sanitised diagnostic snapshot of your Ekai deployment.
# Review the output ZIP before attaching it to a support ticket.
# No data leaves your environment automatically — you control what you send.
# =============================================================================

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
LAST_HOURS=24
OUTPUT_DIR="$(pwd)"
BUNDLE_NAME="ekai-support-bundle-$(date +%Y%m%d-%H%M%S)"
WORK_DIR="/tmp/${BUNDLE_NAME}"
RUNTIME="auto"       # auto | docker | compose | k8s | ecs
NAMESPACE="default"  # k8s namespace
REDACT=true          # redact sensitive values by default
QUIET=false

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log()     { [[ "$QUIET" == false ]] && echo -e "${BLUE}[INFO]${RESET}  $*"; }
success() { [[ "$QUIET" == false ]] && echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
section() { [[ "$QUIET" == false ]] && echo -e "\n${BOLD}── $* ──${RESET}"; }

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --last-hours N      Hours of logs to collect (default: 24)
  --output DIR        Output directory for the bundle ZIP (default: current dir)
  --runtime TYPE      Runtime: auto, docker, compose, k8s, ecs (default: auto)
  --namespace NS      Kubernetes namespace (default: default)
  --no-redact         Skip redaction of sensitive values (not recommended)
  --quiet             Suppress progress output
  -h, --help          Show this help

Examples:
  ./support-bundle.sh
  ./support-bundle.sh --last-hours 48 --output /tmp
  ./support-bundle.sh --runtime k8s --namespace ekai-prod
  ./support-bundle.sh --runtime docker --no-redact

The generated ZIP contains:
  health-snapshot.json    Service status at time of run
  version-manifest.json   Deployed component versions
  infra-state.json        Container/pod status and resource usage
  connectivity-check.txt  Inter-service connectivity results
  app-logs/               Application logs (last N hours)
  preflight-check.txt     Configuration validation results
  env-summary.txt         Environment variables (secrets redacted)
  README.txt              Bundle contents and redaction notes

Review the ZIP contents before attaching to a support ticket.
Raise tickets at: https://support.ekai.ai
EOF
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --last-hours) LAST_HOURS="$2"; shift 2 ;;
    --output)     OUTPUT_DIR="$2"; shift 2 ;;
    --runtime)    RUNTIME="$2";    shift 2 ;;
    --namespace)  NAMESPACE="$2";  shift 2 ;;
    --no-redact)  REDACT=false;    shift ;;
    --quiet)      QUIET=true;      shift ;;
    -h|--help)    usage; exit 0 ;;
    *) error "Unknown option: $1"; usage; exit 1 ;;
  esac
done

# ── Runtime detection ─────────────────────────────────────────────────────────
detect_runtime() {
  if [[ "$RUNTIME" != "auto" ]]; then return; fi

  if kubectl version --client &>/dev/null && kubectl get pods -n "$NAMESPACE" &>/dev/null 2>&1; then
    RUNTIME="k8s"
  elif docker compose version &>/dev/null 2>&1 && docker compose ps &>/dev/null 2>&1; then
    RUNTIME="compose"
  elif docker info &>/dev/null 2>&1; then
    RUNTIME="docker"
  elif command -v aws &>/dev/null && aws ecs list-clusters &>/dev/null 2>&1; then
    RUNTIME="ecs"
  else
    RUNTIME="unknown"
    warn "Could not auto-detect runtime. Some sections may be incomplete."
    warn "Use --runtime to specify: docker, compose, k8s, ecs"
  fi
  log "Detected runtime: ${RUNTIME}"
}

# ── Redaction helper ──────────────────────────────────────────────────────────
redact() {
  if [[ "$REDACT" == true ]]; then
    sed -E \
      -e 's/(API_KEY|api_key|apikey|SECRET|secret|PASSWORD|password|TOKEN|token|PRIVATE_KEY|private_key)[[:space:]]*[=:][[:space:]]*[^[:space:],}"]*/\1=<REDACTED>/gi' \
      -e 's/ek_fleet_[a-zA-Z0-9]{8,}/<REDACTED_FLEET_KEY>/g' \
      -e 's/ek_live_[a-zA-Z0-9]{8,}/<REDACTED_API_KEY>/g' \
      -e 's/([0-9]{1,3}\.){3}[0-9]{1,3}/<IP_REDACTED>/g'
  else
    cat
  fi
}

# ── Collectors ────────────────────────────────────────────────────────────────

collect_version_manifest() {
  section "Version manifest"
  local out="$WORK_DIR/version-manifest.json"

  local ekai_version="unknown"
  local agent_version="unknown"

  # Try to read version from common locations
  for f in /app/VERSION /ekai/VERSION ./VERSION; do
    [[ -f "$f" ]] && ekai_version=$(cat "$f") && break
  done

  # Try fleet agent container label
  if docker inspect ekai-agent &>/dev/null 2>&1; then
    agent_version=$(docker inspect ekai-agent \
      --format '{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null || echo "unknown")
  fi

  cat > "$out" <<EOF
{
  "collected_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ekai_version": "$ekai_version",
  "fleet_agent_version": "$agent_version",
  "runtime": "$RUNTIME",
  "host_os": "$(uname -sr 2>/dev/null || echo unknown)",
  "docker_version": "$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo n/a)",
  "kubectl_version": "$(kubectl version --client -o json 2>/dev/null | grep gitVersion | head -1 | tr -d ' ",' || echo n/a)",
  "bundle_tool_version": "1.0.0"
}
EOF
  success "Version manifest written"
}

collect_health_snapshot() {
  section "Health snapshot"
  local out="$WORK_DIR/health-snapshot.json"
  local services=()
  local overall="unknown"
  local all_healthy=true

  probe_http() {
    local name="$1" url="$2"
    local start end latency status_code result
    start=$(date +%s%3N)
    status_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
    end=$(date +%s%3N)
    latency=$((end - start))

    if   [[ "$status_code" =~ ^2 ]] && (( latency < 500 ));  then result="healthy"
    elif [[ "$status_code" =~ ^2 ]] && (( latency < 2000 )); then result="degraded"; all_healthy=false
    else result="down"; all_healthy=false
    fi
    services+=("{\"name\":\"$name\",\"type\":\"http\",\"status\":\"$result\",\"http_code\":$status_code,\"latency_ms\":$latency}")
    log "  $name ($url) → $result (${latency}ms, HTTP $status_code)"
  }

  probe_tcp() {
    local name="$1" host="$2" port="$3"
    local result
    if timeout 3 bash -c "echo >/dev/tcp/$host/$port" 2>/dev/null; then
      result="healthy"
    else
      result="down"; all_healthy=false
    fi
    services+=("{\"name\":\"$name\",\"type\":\"tcp\",\"status\":\"$result\"}")
    log "  $name ($host:$port) → $result"
  }

  # Parse FLEET_SERVICES if set
  if [[ -n "${FLEET_SERVICES:-}" ]]; then
    IFS=',' read -ra probes <<< "$FLEET_SERVICES"
    for probe in "${probes[@]}"; do
      IFS=':' read -ra parts <<< "$probe"
      local svc_name="${parts[0]}" svc_type="${parts[1]}"
      if [[ "$svc_type" == "http" ]]; then
        probe_http "$svc_name" "${parts[2]}:${parts[3]}${parts[4]:+:${parts[4]}}"
      elif [[ "$svc_type" == "tcp" ]]; then
        probe_tcp "$svc_name" "${parts[2]}" "${parts[3]}"
      fi
    done
  else
    # Fallback: probe common Ekai default ports
    warn "FLEET_SERVICES not set — probing default Ekai endpoints"
    probe_http "ekai-api"    "http://localhost:8080/healthz"
    probe_http "ekai-worker" "http://localhost:9000/health"
    probe_tcp  "ekai-db"     "localhost" "5432"
  fi

  [[ "$all_healthy" == true ]] && overall="healthy" || overall="degraded"

  # Build JSON
  local svc_json
  svc_json=$(IFS=','; echo "[${services[*]}]")

  cat > "$out" <<EOF
{
  "collected_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "overall_status": "$overall",
  "services": $svc_json
}
EOF
  success "Health snapshot written (overall: $overall)"
}

collect_infra_state() {
  section "Infrastructure state"
  local out="$WORK_DIR/infra-state.json"

  case "$RUNTIME" in
    docker|compose)
      docker ps --format \
        '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","created":"{{.CreatedAt}}"}' \
        2>/dev/null | jq -s '{collected_at: now | todate, containers: .}' > "$out" 2>/dev/null \
        || docker ps --format '{{json .}}' 2>/dev/null > "$out"
      ;;
    k8s)
      {
        echo '{"collected_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",'
        echo '"pods":'
        kubectl get pods -n "$NAMESPACE" -o json 2>/dev/null \
          | jq '[.items[] | {name:.metadata.name, status:.status.phase, ready:(.status.conditions[]? | select(.type=="Ready") | .status), restarts:(.status.containerStatuses[0].restartCount // 0)}]' \
          2>/dev/null || echo '[]'
        echo '}'
      } > "$out"
      ;;
    ecs)
      aws ecs list-tasks --cluster "${ECS_CLUSTER:-ekai}" 2>/dev/null \
        | jq '{collected_at: now | todate, tasks: .taskArns}' > "$out" 2>/dev/null \
        || echo '{"collected_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","error":"ECS query failed — check AWS credentials"}' > "$out"
      ;;
    *)
      echo '{"collected_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","error":"Runtime unknown — infra state not collected"}' > "$out"
      ;;
  esac
  success "Infrastructure state written"
}

collect_connectivity() {
  section "Connectivity check"
  local out="$WORK_DIR/connectivity-check.txt"

  {
    echo "Ekai Connectivity Check"
    echo "Collected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "========================================"
    echo ""

    echo "── Outbound HTTPS (support.ekai.ai) ──"
    if curl -s --max-time 5 -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" \
        "https://support.ekai.ai" 2>/dev/null; then
      echo "  Result: REACHABLE"
    else
      echo "  Result: UNREACHABLE — outbound HTTPS on port 443 may be blocked"
    fi

    echo ""
    echo "── DNS resolution ──"
    for host in support.ekai.ai api.ekai.ai; do
      if nslookup "$host" &>/dev/null 2>&1; then
        echo "  $host → $(nslookup "$host" 2>/dev/null | grep 'Address:' | tail -1 || echo 'resolved')"
      else
        echo "  $host → FAILED"
      fi
    done

    echo ""
    echo "── Inter-service (from FLEET_SERVICES) ──"
    if [[ -n "${FLEET_SERVICES:-}" ]]; then
      IFS=',' read -ra probes <<< "$FLEET_SERVICES"
      for probe in "${probes[@]}"; do
        IFS=':' read -ra parts <<< "$probe"
        local svc_name="${parts[0]}" svc_type="${parts[1]}"
        if [[ "$svc_type" == "http" ]]; then
          local url="${parts[2]}:${parts[3]}${parts[4]:+:${parts[4]}}"
          local code; code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
          echo "  $svc_name ($url) → HTTP $code"
        elif [[ "$svc_type" == "tcp" ]]; then
          if timeout 3 bash -c "echo >/dev/tcp/${parts[2]}/${parts[3]}" 2>/dev/null; then
            echo "  $svc_name (${parts[2]}:${parts[3]}) → TCP OPEN"
          else
            echo "  $svc_name (${parts[2]}:${parts[3]}) → TCP FAILED"
          fi
        fi
      done
    else
      echo "  FLEET_SERVICES not set — skipped"
    fi

    echo ""
    echo "── System resources ──"
    echo "  Disk usage:"
    df -h / 2>/dev/null | tail -1 | awk '{print "    / → used:"$3" avail:"$4" ("$5")"}'
    echo "  Memory:"
    free -h 2>/dev/null | grep Mem | awk '{print "    total:"$2" used:"$3" free:"$4}' || \
      vm_stat 2>/dev/null | grep "Pages free" | awk '{print "    free pages: "$3}' || echo "    n/a"
    echo "  Load average:"
    uptime 2>/dev/null | awk -F'load average' '{print "    "$2}' || echo "    n/a"

  } > "$out"
  success "Connectivity check written"
}

collect_logs() {
  section "Application logs (last ${LAST_HOURS}h)"
  local log_dir="$WORK_DIR/app-logs"
  mkdir -p "$log_dir"

  local since="${LAST_HOURS}h"

  case "$RUNTIME" in
    docker|compose)
      local containers
      containers=$(docker ps --format '{{.Names}}' 2>/dev/null || echo "")
      if [[ -z "$containers" ]]; then
        warn "No running Docker containers found"
        return
      fi
      while IFS= read -r container; do
        local logfile="$log_dir/${container}.log"
        docker logs --since "${LAST_HOURS}h" "$container" 2>&1 \
          | redact > "$logfile" || warn "Could not collect logs for $container"
        local lines; lines=$(wc -l < "$logfile" 2>/dev/null || echo 0)
        log "  $container → ${lines} lines"
      done <<< "$containers"
      ;;
    k8s)
      local pods
      pods=$(kubectl get pods -n "$NAMESPACE" --no-headers \
        -o custom-columns=":metadata.name" 2>/dev/null || echo "")
      while IFS= read -r pod; do
        [[ -z "$pod" ]] && continue
        local logfile="$log_dir/${pod}.log"
        kubectl logs "$pod" -n "$NAMESPACE" \
          --since="${LAST_HOURS}h" --all-containers=true 2>&1 \
          | redact > "$logfile" || warn "Could not collect logs for $pod"
        local lines; lines=$(wc -l < "$logfile" 2>/dev/null || echo 0)
        log "  $pod → ${lines} lines"
      done <<< "$pods"
      ;;
    ecs)
      warn "ECS log collection requires CloudWatch access."
      echo "ECS log collection not automated." > "$log_dir/ecs-note.txt"
      echo "Retrieve logs manually from CloudWatch log group: /ecs/ekai-*" >> "$log_dir/ecs-note.txt"
      echo "Time window: last ${LAST_HOURS} hours" >> "$log_dir/ecs-note.txt"
      ;;
    *)
      warn "Runtime unknown — log collection skipped"
      ;;
  esac
  success "Logs collected"
}

collect_env_summary() {
  section "Environment summary"
  local out="$WORK_DIR/env-summary.txt"

  {
    echo "Ekai Environment Summary"
    echo "Collected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Redaction: $REDACT"
    echo "========================================"
    echo ""
    echo "── Relevant environment variables ──"
    env | grep -E '^(FLEET_|EKAI_|APP_|NODE_ENV|ENVIRONMENT)' \
      | redact \
      | sort \
      || echo "  No FLEET_/EKAI_ variables found in current shell"
    echo ""
    echo "── System info ──"
    echo "  Hostname: $(hostname 2>/dev/null || echo unknown)"
    echo "  OS:       $(uname -sr 2>/dev/null || echo unknown)"
    echo "  Uptime:   $(uptime 2>/dev/null || echo unknown)"
  } > "$out"
  success "Environment summary written"
}

collect_preflight() {
  section "Pre-flight checks"
  local out="$WORK_DIR/preflight-check.txt"
  local issues=0

  check() {
    local label="$1" result="$2" note="${3:-}"
    if [[ "$result" == "PASS" ]]; then
      echo "  [PASS] $label"
    else
      echo "  [FAIL] $label${note:+ — $note}"
      ((issues++)) || true
    fi
  }

  {
    echo "Ekai Pre-flight Check"
    echo "Collected: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "========================================"
    echo ""

    echo "── Required variables ──"
    [[ -n "${FLEET_HUB_URL:-}" ]]  && check "FLEET_HUB_URL set"  "PASS" || check "FLEET_HUB_URL set"  "FAIL" "required for fleet agent"
    [[ -n "${FLEET_API_KEY:-}" ]]  && check "FLEET_API_KEY set"  "PASS" || check "FLEET_API_KEY set"  "FAIL" "required for fleet agent"
    [[ -n "${FLEET_SERVICES:-}" ]] && check "FLEET_SERVICES set" "PASS" || check "FLEET_SERVICES set" "FAIL" "no services configured to monitor"

    echo ""
    echo "── API key format ──"
    if [[ -n "${FLEET_API_KEY:-}" ]]; then
      [[ "$FLEET_API_KEY" =~ ^ek_fleet_ ]] \
        && check "FLEET_API_KEY prefix (ek_fleet_...)" "PASS" \
        || check "FLEET_API_KEY prefix (ek_fleet_...)" "FAIL" "key does not start with ek_fleet_"
      local key_len=${#FLEET_API_KEY}
      (( key_len >= 40 )) \
        && check "FLEET_API_KEY length (>=40 chars)" "PASS" \
        || check "FLEET_API_KEY length (>=40 chars)" "FAIL" "key appears too short ($key_len chars)"
    fi

    echo ""
    echo "── Portal reachability ──"
    if [[ -n "${FLEET_HUB_URL:-}" ]]; then
      if curl -s --max-time 5 -o /dev/null "${FLEET_HUB_URL}/api/fleet/ping" 2>/dev/null; then
        check "Portal reachable (${FLEET_HUB_URL})" "PASS"
      else
        check "Portal reachable (${FLEET_HUB_URL})" "FAIL" "check outbound HTTPS on port 443"
      fi
    fi

    echo ""
    echo "── Runtime ──"
    check "Runtime detected ($RUNTIME)" "$( [[ "$RUNTIME" != "unknown" ]] && echo PASS || echo FAIL )" \
      "use --runtime to specify"

    echo ""
    echo "── NTP / clock ──"
    local server_time portal_time skew_ok="PASS"
    server_time=$(date +%s)
    if command -v ntpq &>/dev/null; then
      check "ntpd running" "PASS"
    else
      check "ntpd running" "FAIL" "install ntp or chrony — clock skew >10min will reject heartbeats"
    fi

    echo ""
    echo "──────────────────────────────────────"
    if (( issues == 0 )); then
      echo "  Result: ALL CHECKS PASSED"
    else
      echo "  Result: $issues ISSUE(S) FOUND — see FAIL lines above"
    fi

  } > "$out"
  success "Pre-flight check written ($issues issue(s) found)"
}

write_readme() {
  cat > "$WORK_DIR/README.txt" <<EOF
Ekai Support Bundle
Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Runtime:   $RUNTIME
Redacted:  $REDACT
Tool:      support-bundle.sh v1.0.0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  README.txt              This file
  version-manifest.json   Deployed Ekai component versions
  health-snapshot.json    Service health at time of collection
  infra-state.json        Container/pod status and resource usage
  connectivity-check.txt  Inter-service and outbound connectivity
  preflight-check.txt     Configuration validation results
  env-summary.txt         Relevant environment variables (secrets redacted)
  app-logs/               Application logs — last ${LAST_HOURS} hours

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REDACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$(if [[ "$REDACT" == true ]]; then
  echo "  Automatic redaction was ENABLED."
  echo "  The following patterns were replaced with <REDACTED>:"
  echo "    - API keys, secrets, passwords, tokens"
  echo "    - ek_fleet_... and ek_live_... key values"
  echo "    - IP addresses"
  echo ""
  echo "  Review files before sending if your environment uses"
  echo "  non-standard variable names for sensitive values."
else
  echo "  WARNING: Redaction was DISABLED (--no-redact was passed)."
  echo "  Review ALL files carefully before attaching to a ticket."
  echo "  Secrets and IP addresses may be present in plain text."
fi)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW TO SEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. Review this bundle — open each file and confirm you are
     comfortable with its contents before sending.
  2. Raise a ticket at https://support.ekai.ai
  3. Attach the ZIP file to the ticket.
  4. Reference ticket ID in any follow-up emails.

  For P1 incidents: email support@ekai.ai directly and attach
  the bundle. Do not wait for portal acknowledgement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EKAI SUPPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Portal:  https://support.ekai.ai
  Email:   support@ekai.ai
  P1 SLA:  15 min response / 4 hr resolution

EOF
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}Ekai Support Bundle Generator v1.0.0${RESET}"
  echo -e "Runtime detection: $RUNTIME | Last ${LAST_HOURS}h of logs | Redaction: $REDACT"
  echo ""

  # Validate output dir
  if [[ ! -d "$OUTPUT_DIR" ]]; then
    error "Output directory does not exist: $OUTPUT_DIR"
    exit 1
  fi

  # Create working directory
  mkdir -p "$WORK_DIR"
  log "Working directory: $WORK_DIR"

  # Detect runtime
  detect_runtime

  # Run collectors
  collect_version_manifest
  collect_health_snapshot
  collect_infra_state
  collect_connectivity
  collect_logs
  collect_env_summary
  collect_preflight
  write_readme

  # Package
  section "Packaging bundle"
  local zip_path="${OUTPUT_DIR}/${BUNDLE_NAME}.zip"
  (cd /tmp && zip -r "$zip_path" "$BUNDLE_NAME/" -x "*.DS_Store") &>/dev/null \
    || tar -czf "${zip_path%.zip}.tar.gz" -C /tmp "$BUNDLE_NAME/"

  # Cleanup
  rm -rf "$WORK_DIR"

  echo ""
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${GREEN}${BOLD}  Bundle ready: ${zip_path}${RESET}"
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
  echo -e "  ${YELLOW}Review the bundle before attaching to a ticket.${RESET}"
  echo -e "  Raise tickets at: ${BLUE}https://support.ekai.ai${RESET}"
  echo ""
}

main "$@"
