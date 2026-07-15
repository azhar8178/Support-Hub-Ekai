# Ekai Monitoring & Support Visibility Options

**Version 1.0 · July 2026 · [support.ekai.ai](https://support.ekai.ai)**

---

## Overview

Because Ekai runs entirely within your cloud environment, you control how much visibility you share with the Ekai support team. There is no single mandatory approach — choose the tier that fits your organisation's security posture and operational preferences.

All three tiers give you full support access. The difference is **how quickly we can diagnose issues** and **how proactively we can respond.**

---

## Comparison at a Glance

| | Tier 1 — Full Telemetry | Tier 2 — Local Dashboard | Tier 3 — On-Demand Bundle |
|---|---|---|---|
| **Setup effort** | Low | Medium | Minimal |
| **Ekai sees your health data** | Continuously | Never | Only when you send it |
| **Proactive alerting by Ekai** | ✅ Yes | ❌ No | ❌ No |
| **Auto P1 ticket on outage** | ✅ Yes | ❌ No | ❌ No |
| **Customer self-visibility** | Via portal | Via local dashboard | Via bundle output |
| **Data leaves your environment** | Health signals only | Nothing | Only when you send |
| **Best for** | Most deployments | High-security / regulated | Air-gapped / full control |

---

## Tier 1 — Full Telemetry (Recommended)

### How it works

The Ekai Fleet Agent runs as a sidecar container alongside your deployment. Every 60 seconds it probes your services and pushes a signed health payload to `support.ekai.ai` over outbound HTTPS. No inbound ports are opened. The Ekai support team sees your environment's health in real time.

```
Your Cloud Environment
┌──────────────────────────────────┐
│  Ekai Platform  │  Fleet Agent  │──── HTTPS push ──▶ support.ekai.ai
└──────────────────────────────────┘     (outbound 443)
```

### What Ekai receives

- Service status (healthy / degraded / down) per configured probe
- Response latency per service
- Optional: CPU and memory usage (requires `psutil`)
- Infrastructure labels you set: cloud, region, runtime, version

**No business data, no query data, no customer records — only infrastructure signals.**

See the [Fleet Agent Onboarding Guide](https://support.ekai.ai/kb) for the full payload schema.

### What you get

- Real-time health dashboard at `support.ekai.ai/health`
- Ekai support team is alerted automatically if your environment degrades or goes offline
- P1 ticket auto-created within minutes of an outage — often before your team is aware
- 24-hour status history and uptime tracking
- Fastest support resolution times

### Setup

Follow the [Fleet Agent Onboarding Guide](https://support.ekai.ai/kb). Typical setup time: **30 minutes**.

### Who this is for

Most Ekai customers. Suitable for any environment where outbound HTTPS to `support.ekai.ai` on port 443 is permitted.

---

## Tier 2 — Local Dashboard Only

### How it works

The Fleet Agent is deployed as in Tier 1, but configured to push telemetry to a **local instance** running inside your environment rather than to `support.ekai.ai`. You get full health visibility via a dashboard inside your own cloud. Ekai sees nothing unless you share it.

```
Your Cloud Environment
┌──────────────────────────────────────────────────┐
│  Ekai Platform  │  Fleet Agent  │  Local Dashboard│
│                 │   (push ──────────────▶)        │
└──────────────────────────────────────────────────┘
        Nothing leaves your environment
```

### What you get

- Full health dashboard inside your own environment
- Status history, service-level metrics, alert history
- No continuous data sharing with Ekai

### What Ekai gets

Nothing automatically. When you raise a support ticket, you share relevant screenshots or exports from the local dashboard at your discretion.

### Setup

1. Deploy the Fleet Agent with `FLEET_HUB_URL` pointed at your local dashboard endpoint instead of `https://support.ekai.ai`
2. Deploy the local dashboard component (contact your Ekai deployment team for the configuration)
3. Configure alerting within your environment (PagerDuty, OpsGenie, email — your choice)

Typical setup time: **2–4 hours**. Requires a persistent endpoint inside your environment to receive the telemetry.

### Who this is for

Organisations with strict data residency requirements, regulated industries (financial services, healthcare, government), or environments where no outbound data to third-party SaaS tools is permitted by policy.

> ⚠️ **Note on support response times**
>
> Without continuous telemetry, Ekai support cannot proactively detect or respond to incidents. Support response times remain the same per SLA, but resolution may take longer as diagnostics require additional back-and-forth with your team.

---

## Tier 3 — On-Demand Support Bundle

### How it works

No agent, no continuous telemetry, no persistent data sharing. The Ekai deployment package includes a `support-bundle.sh` script. When you need support, you run the script — it collects a diagnostic snapshot, you review it, and you attach it to your support ticket.

```
Your Cloud Environment
┌─────────────────────────────────────┐
│  Ekai Platform                      │
│                                     │
│  $ ./support-bundle.sh              │
│    → ekai-bundle-20260715.zip       │──── You review ────▶ You send ──▶ Ekai
└─────────────────────────────────────┘         (on demand, your control)
```

### What the bundle contains

```
ekai-support-bundle-YYYYMMDD-HHMMSS.zip
├── README.txt                ← contents and redaction notes
├── health-snapshot.json      ← service status at time of run
├── version-manifest.json     ← deployed component versions
├── infra-state.json          ← container/pod status and resource usage
├── connectivity-check.txt    ← inter-service and outbound connectivity
├── preflight-check.txt       ← configuration validation
├── env-summary.txt           ← environment variables (secrets redacted)
└── app-logs/                 ← application logs, last N hours
```

**Secrets and API keys are redacted automatically.** You review the bundle contents before sending. You decide what to include.

### Running the script

```bash
# Basic — last 24 hours of logs
./support-bundle.sh

# Specify log window
./support-bundle.sh --last-hours 48

# Kubernetes deployment
./support-bundle.sh --runtime k8s --namespace ekai-prod

# Save to specific location
./support-bundle.sh --output /tmp --last-hours 6
```

Then attach the ZIP to your ticket at [support.ekai.ai](https://support.ekai.ai).

### What you get

- Full control over what diagnostic data you share
- No persistent agent or outbound connections
- Works in fully air-gapped environments with no internet access
- Compatible with the strictest security policies

### What Ekai gets

Only what you send, only when you send it. Ekai has zero visibility into your environment between support interactions.

### Who this is for

Air-gapped deployments, classified environments, or organisations whose security policy prohibits any outbound data from production systems. Also suitable as a supplement to Tier 2 for structured incident escalation.

> ⚠️ **Note on support response times**
>
> Diagnosing issues without continuous telemetry takes longer. For P1 incidents, please run the support bundle immediately and include it with your ticket or email to `support@ekai.ai`. This significantly reduces time-to-resolution.

---

## How to Choose

**Answer these questions:**

**1. Can your environment make outbound HTTPS calls to `support.ekai.ai` on port 443?**
- Yes → Tier 1 or Tier 2
- No → Tier 3

**2. Does your security policy permit operational metrics to be sent to a third-party SaaS portal?**
- Yes → Tier 1
- No, but internal dashboard is fine → Tier 2
- No outbound data at all → Tier 3

**3. How important is proactive monitoring to you?**
- Critical — we want Ekai to know before we do → Tier 1
- We'll handle our own monitoring → Tier 2 or 3

**4. What's your deployment model?**
- Ekai deploys and operates → Tier 1
- Ekai deploys, we operate → Tier 1 or 2
- We deploy ourselves → Tier 2 or 3
- Fully self-managed, air-gapped → Tier 3

---

## Changing Tiers

You can change visibility tier at any time. Contact your Ekai support admin:

- **Upgrading to Tier 1:** deploy the Fleet Agent and register your environment in the portal — takes about 30 minutes
- **Downgrading to Tier 3:** deactivate the environment in Settings → Fleet — the agent stops sending immediately, historical data is retained per retention policy (24 hours for snapshots)
- **Moving to Tier 2:** requires deploying the local dashboard component — your Ekai deployment team can assist

---

## Frequently Asked Questions

**Does the Fleet Agent (Tier 1) have access to my data or queries?**
No. The agent only probes service health endpoints and collects infrastructure metrics. It has no access to your database contents, query history, or business data.

**Can I see exactly what the agent sends?**
Yes. The full payload schema is documented in the [Fleet Agent Onboarding Guide](https://support.ekai.ai/kb). You can also run `support-bundle.sh` at any time to see a snapshot of what would be in a heartbeat.

**What if I want Tier 1 for staging but Tier 3 for production?**
You can use different tiers per environment. Register each environment separately in the portal and configure the agent accordingly.

**Is the support bundle encrypted?**
The ZIP is not encrypted at rest — it is intended for you to review before sending. If your security policy requires encrypted transfer, raise the ticket in the portal and use the secure file upload rather than email.

**What data does Ekai retain from the fleet agent?**
Individual heartbeat snapshots are retained for 24 hours. Status transitions (healthy → degraded → down) and alert records are retained indefinitely for audit and SLA reporting purposes.

---

## Setting Your Tier at Onboarding

During your onboarding call with the Ekai team, you will be asked to confirm your visibility tier. This determines:

- Which components are included in your deployment package
- How your support contacts are configured in the portal
- What diagnostic steps Ekai support will ask for when a ticket is raised

If you are unsure, **start with Tier 1** — it can be downgraded at any time with no service impact.

---

*Ekai.ai — Confidential · Monitoring & Visibility Options v1.0 · July 2026*
