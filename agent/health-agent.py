#!/usr/bin/env python3
"""
Ekai Fleet Agent — standalone heartbeat pusher.

Runs inside each customer cloud environment and periodically POSTs heartbeat
payloads to the Ekai Support Portal fleet endpoint.

Dependencies: requests, psutil (both optional — degrades gracefully)
Python >= 3.8

Configuration via environment variables:
  FLEET_HUB_URL      – e.g. https://support.ekai.ai  (REQUIRED)
  FLEET_API_KEY      – the ek_fleet_... token from registration  (REQUIRED)
  FLEET_INTERVAL     – push interval in seconds (default: 300)
  FLEET_SERVICES     – JSON array of services to probe (see below)
  FLEET_CLOUD        – aws | azure | gcp | other
  FLEET_REGION       – e.g. eu-west-1
  FLEET_RUNTIME      – ecs | eks | aks | gke | docker | k8s | vm | other
  FLEET_VERSION      – current Ekai deployment version (e.g. 1.4.2)

FLEET_SERVICES JSON format:
[
  {"name": "ekai-api",  "type": "api",      "url": "http://localhost:8080/health", "timeout": 5},
  {"name": "ekai-db",   "type": "database", "url": "tcp://db-host:5432",           "timeout": 3},
  {"name": "ekai-redis","type": "cache",    "url": "tcp://redis-host:6379",        "timeout": 2}
]

Service URL schemes:
  http:// or https://  — HTTP GET probe (200-399 = healthy, 500-2000ms = degraded, >2000ms = down)
  tcp://               — TCP socket connect probe (connected = healthy, refused/timeout = down)
"""

import json
import logging
import os
import platform
import signal
import socket
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# Optional dependencies
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    import urllib.request
    import urllib.error

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger("ekai-fleet-agent")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _require(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        log.error("Required environment variable %s is not set. Exiting.", name)
        sys.exit(1)
    return val

HUB_URL       = _require("FLEET_HUB_URL").rstrip("/")
API_KEY       = _require("FLEET_API_KEY")
INTERVAL      = int(os.environ.get("FLEET_INTERVAL", "300"))
CLOUD         = os.environ.get("FLEET_CLOUD", "other")
REGION        = os.environ.get("FLEET_REGION", "unknown")
RUNTIME       = os.environ.get("FLEET_RUNTIME", "other")
VERSION       = os.environ.get("FLEET_VERSION", "unknown")
SERVICES_RAW  = os.environ.get("FLEET_SERVICES", "[]")

HEARTBEAT_URL = f"{HUB_URL}/api/fleet/heartbeat"

try:
    SERVICES: List[Dict[str, Any]] = json.loads(SERVICES_RAW)
    if not isinstance(SERVICES, list):
        raise ValueError("FLEET_SERVICES must be a JSON array")
except (json.JSONDecodeError, ValueError) as exc:
    log.error("Invalid FLEET_SERVICES JSON: %s", exc)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------

_running = True

def _handle_sigterm(signum: int, frame: Any) -> None:
    global _running
    log.info("Received SIGTERM — shutting down gracefully.")
    _running = False

signal.signal(signal.SIGTERM, _handle_sigterm)
signal.signal(signal.SIGINT, _handle_sigterm)

# ---------------------------------------------------------------------------
# Service probing
# ---------------------------------------------------------------------------

def _probe_http(url: str, timeout: int) -> Tuple[str, float]:
    """Return (status, latency_ms). Status: healthy | degraded | down."""
    start = time.monotonic()
    try:
        if HAS_REQUESTS:
            resp = requests.get(url, timeout=timeout, allow_redirects=True)
            latency_ms = (time.monotonic() - start) * 1000
            if resp.status_code < 400:
                return ("healthy" if latency_ms < 500 else "degraded", latency_ms)
            return ("degraded", latency_ms)
        else:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                latency_ms = (time.monotonic() - start) * 1000
                code = resp.getcode()
                if code < 400:
                    return ("healthy" if latency_ms < 500 else "degraded", latency_ms)
                return ("degraded", latency_ms)
    except Exception:
        latency_ms = (time.monotonic() - start) * 1000
        return ("down", latency_ms)


def _probe_tcp(url: str, timeout: int) -> Tuple[str, float]:
    """Parse tcp://host:port and attempt a socket connection."""
    try:
        # Strip tcp:// scheme
        hostport = url.replace("tcp://", "").replace("//", "")
        host, port_str = hostport.rsplit(":", 1)
        port = int(port_str)
    except (ValueError, AttributeError):
        return ("down", 0.0)

    start = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            latency_ms = (time.monotonic() - start) * 1000
            return ("healthy", latency_ms)
    except Exception:
        latency_ms = (time.monotonic() - start) * 1000
        return ("down", latency_ms)


def probe_service(svc: Dict[str, Any]) -> Dict[str, Any]:
    """Probe a single service and return its health dict."""
    name    = svc.get("name", "unknown")
    svc_type = svc.get("type", "api")
    url     = svc.get("url", "")
    timeout = int(svc.get("timeout", 5))

    if url.startswith(("http://", "https://")):
        status, latency_ms = _probe_http(url, timeout)
    elif url.startswith("tcp://"):
        status, latency_ms = _probe_tcp(url, timeout)
    else:
        # Unknown scheme — mark as degraded
        status, latency_ms = "degraded", 0.0

    # System metrics (null if psutil unavailable)
    cpu_pct: Optional[float] = None
    mem_pct: Optional[float] = None
    if HAS_PSUTIL:
        try:
            cpu_pct = psutil.cpu_percent(interval=None)
            mem_pct = psutil.virtual_memory().percent
        except Exception:
            pass

    return {
        "name": name,
        "status": status,
        "latency_ms": round(latency_ms, 1),
        "cpu_percent": cpu_pct,
        "memory_percent": mem_pct,
        "error_rate_percent": None,
    }


def overall_status(services: List[Dict[str, Any]]) -> str:
    statuses = [s["status"] for s in services]
    if "down" in statuses:
        return "down"
    if "degraded" in statuses:
        return "degraded"
    return "healthy"


# ---------------------------------------------------------------------------
# Payload construction
# ---------------------------------------------------------------------------

def build_payload(services: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": overall_status(services),
        "version": VERSION,
        "services": services,
        "platform": {
            "cloud":   CLOUD,
            "region":  REGION,
            "runtime": RUNTIME,
            "os":      platform.system(),
        },
    }


# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------

def push(payload: Dict[str, Any]) -> bool:
    headers = {
        "Content-Type": "application/json",
        "X-Fleet-API-Key": API_KEY,
    }
    body = json.dumps(payload).encode("utf-8")

    try:
        if HAS_REQUESTS:
            resp = requests.post(HEARTBEAT_URL, data=body, headers=headers, timeout=10)
            if resp.status_code == 200:
                log.info(
                    "Heartbeat accepted. status=%s services=%d next_push=%ds",
                    payload["status"], len(payload["services"]), INTERVAL,
                )
                return True
            log.warning("Heartbeat rejected: HTTP %d — %s", resp.status_code, resp.text[:200])
            return False
        else:
            req = urllib.request.Request(
                HEARTBEAT_URL, data=body,
                headers={k: v for k, v in headers.items()},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                log.info(
                    "Heartbeat accepted. status=%s services=%d next_push=%ds",
                    payload["status"], len(payload["services"]), INTERVAL,
                )
                return True
    except Exception as exc:
        log.warning("Failed to push heartbeat: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    log.info(
        "Ekai Fleet Agent starting. Monitoring %d service(s). Push interval: %ds. Hub: %s",
        len(SERVICES), INTERVAL, HUB_URL,
    )

    while _running:
        # Probe all services
        probed = [probe_service(s) for s in SERVICES]

        # Build and push payload
        payload = build_payload(probed)
        push(payload)

        # Sleep in 1-second increments so SIGTERM is handled promptly
        for _ in range(INTERVAL):
            if not _running:
                break
            time.sleep(1)

    log.info("Fleet agent stopped.")


if __name__ == "__main__":
    main()
