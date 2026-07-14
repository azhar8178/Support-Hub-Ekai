#!/usr/bin/env python3
"""
Ekai Health Agent — standalone telemetry pusher.

Runs inside each customer cloud environment and periodically POSTs health
signals to the Ekai Support Portal telemetry endpoint.

Dependencies: requests, psutil (both optional — degrades gracefully)
Python >= 3.8

Configuration via environment variables:
  EKAI_PORTAL_URL        – e.g. https://support.ekai.ai
  EKAI_CUSTOMER_ID       – customer identifier
  EKAI_API_KEY           – the key generated in the admin panel
  EKAI_ENVIRONMENT       – production | staging | dev
  EKAI_CLOUD             – aws | azure | gcp | other
  EKAI_REGION            – e.g. eu-west-1
  EKAI_AGENT_VERSION     – e.g. 1.0.0
  EKAI_SERVICES          – JSON array of services to probe (see README)
  EKAI_PUSH_INTERVAL     – seconds between pushes (default 300)
"""

import json
import logging
import os
import platform
import socket
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Optional dependencies — degrade gracefully if absent
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    logging.warning("'requests' not installed — using urllib fallback")
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
log = logging.getLogger("ekai-agent")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PORTAL_URL    = os.environ.get("EKAI_PORTAL_URL", "").rstrip("/")
CUSTOMER_ID   = os.environ.get("EKAI_CUSTOMER_ID", "")
API_KEY       = os.environ.get("EKAI_API_KEY", "")
ENVIRONMENT   = os.environ.get("EKAI_ENVIRONMENT", "production")
CLOUD         = os.environ.get("EKAI_CLOUD", "other")
REGION        = os.environ.get("EKAI_REGION", "unknown")
AGENT_VERSION = os.environ.get("EKAI_AGENT_VERSION", "1.0.0")
PUSH_INTERVAL = int(os.environ.get("EKAI_PUSH_INTERVAL", "300"))
SERVICES_JSON = os.environ.get("EKAI_SERVICES", "[]")

INGEST_URL = f"{PORTAL_URL}/api/telemetry/ingest"

def _require_env(name: str, value: str) -> str:
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not set")
    return value

# ---------------------------------------------------------------------------
# Service probing
# ---------------------------------------------------------------------------

def _probe_http(url: str, timeout: float) -> Dict[str, Any]:
    """HTTP GET probe. Returns status, latency_ms."""
    start = time.monotonic()
    try:
        if HAS_REQUESTS:
            resp = requests.get(url, timeout=timeout)
            latency_ms = (time.monotonic() - start) * 1000
            if resp.status_code >= 500:
                return {"status": "down", "latency_ms": round(latency_ms)}
            elif latency_ms > 2000 or resp.status_code >= 400:
                return {"status": "degraded", "latency_ms": round(latency_ms)}
            else:
                return {"status": "healthy", "latency_ms": round(latency_ms)}
        else:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                latency_ms = (time.monotonic() - start) * 1000
                if resp.status >= 500:
                    return {"status": "down", "latency_ms": round(latency_ms)}
                elif latency_ms > 2000:
                    return {"status": "degraded", "latency_ms": round(latency_ms)}
                return {"status": "healthy", "latency_ms": round(latency_ms)}
    except Exception as exc:
        latency_ms = (time.monotonic() - start) * 1000
        log.debug("HTTP probe %s failed: %s", url, exc)
        return {"status": "down", "latency_ms": round(latency_ms)}


def _probe_tcp(host: str, port: int, timeout: float) -> Dict[str, Any]:
    """TCP connect probe. Returns status, latency_ms."""
    start = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            latency_ms = (time.monotonic() - start) * 1000
            if latency_ms > 2000:
                return {"status": "degraded", "latency_ms": round(latency_ms)}
            return {"status": "healthy", "latency_ms": round(latency_ms)}
    except Exception as exc:
        latency_ms = (time.monotonic() - start) * 1000
        log.debug("TCP probe %s:%d failed: %s", host, port, exc)
        return {"status": "down", "latency_ms": round(latency_ms)}


def probe_service(svc: Dict[str, Any]) -> Dict[str, Any]:
    """Probe one service and return a service health record."""
    name = svc.get("name", "unknown")
    svc_type = svc.get("type", "other")
    health_url = svc.get("health_url", "")
    timeout = float(svc.get("timeout_seconds", 5))

    if health_url.startswith("http://") or health_url.startswith("https://"):
        result = _probe_http(health_url, timeout)
    elif ":" in health_url and not health_url.startswith("/"):
        # host:port TCP check
        parts = health_url.rsplit(":", 1)
        try:
            result = _probe_tcp(parts[0], int(parts[1]), timeout)
        except ValueError:
            result = {"status": "down", "latency_ms": 0}
    else:
        log.warning("Cannot probe service %s — unrecognised health_url: %s", name, health_url)
        result = {"status": "down", "latency_ms": 0}

    # System metrics (if psutil available)
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
        "type": svc_type,
        "status": result["status"],
        "cpu_percent": cpu_pct,
        "memory_percent": mem_pct,
        "latency_ms": result["latency_ms"],
        "error_rate_percent": 0.0,  # not measurable from outside
        "uptime_seconds": int(time.monotonic()),
        "metadata": svc.get("metadata", {}),
    }


def compute_overall(services: List[Dict[str, Any]]) -> str:
    statuses = {s["status"] for s in services}
    if "down" in statuses:
        return "down"
    if "degraded" in statuses:
        return "degraded"
    return "healthy"

# ---------------------------------------------------------------------------
# Payload construction & push
# ---------------------------------------------------------------------------

def build_payload(services: List[Dict[str, Any]]) -> Dict[str, Any]:
    overall = compute_overall(services) if services else "healthy"
    return {
        "customer_id": CUSTOMER_ID,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "environment": ENVIRONMENT,
        "cloud": CLOUD,
        "region": REGION,
        "agent_version": AGENT_VERSION,
        "overall_status": overall,
        "services": services,
        "platform": {
            "runtime": os.environ.get("EKAI_RUNTIME", "unknown"),
            "os": platform.system(),
            "agent_host": socket.gethostname(),
        },
    }


def push(payload: Dict[str, Any]) -> bool:
    """POST payload to ingest endpoint. Returns True on success."""
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-Ekai-API-Key": API_KEY,
    }

    try:
        if HAS_REQUESTS:
            resp = requests.post(INGEST_URL, data=body, headers=headers, timeout=10)
            log.info(
                "Push %s → HTTP %d | overall=%s",
                payload["timestamp"],
                resp.status_code,
                payload["overall_status"],
            )
            return resp.status_code == 200
        else:
            req = urllib.request.Request(INGEST_URL, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                log.info(
                    "Push %s → HTTP %d | overall=%s",
                    payload["timestamp"],
                    resp.status,
                    payload["overall_status"],
                )
                return resp.status == 200
    except Exception as exc:
        log.error("Push failed: %s", exc)
        return False

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run() -> None:
    _require_env("EKAI_PORTAL_URL", PORTAL_URL)
    _require_env("EKAI_CUSTOMER_ID", CUSTOMER_ID)
    _require_env("EKAI_API_KEY", API_KEY)

    try:
        services_cfg: List[Dict[str, Any]] = json.loads(SERVICES_JSON)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"EKAI_SERVICES is not valid JSON: {exc}") from exc

    log.info(
        "Ekai Health Agent v%s starting — portal=%s customer=%s interval=%ds services=%d",
        AGENT_VERSION, PORTAL_URL, CUSTOMER_ID, PUSH_INTERVAL, len(services_cfg),
    )

    while True:
        try:
            probed = [probe_service(svc) for svc in services_cfg]
            payload = build_payload(probed)
            push(payload)
        except Exception as exc:
            log.error("Unexpected error in push cycle: %s", exc)
        # Always sleep — never crash
        time.sleep(PUSH_INTERVAL)


if __name__ == "__main__":
    run()
