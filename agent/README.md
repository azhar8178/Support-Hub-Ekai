# Ekai Health Agent

A lightweight standalone script that runs inside each customer cloud environment
and pushes health signals to the Ekai Support Portal every 5 minutes.

## How it works

1. For each configured service, probes the `health_url` (HTTP GET or TCP connect)
2. Collects system metrics via `psutil` (if installed)
3. Computes an `overall_status`: any DOWN → down, any DEGRADED → degraded, else healthy
4. POSTs the payload to `EKAI_PORTAL_URL/api/telemetry/ingest`
5. Sleeps `EKAI_PUSH_INTERVAL` seconds, then repeats — never crashes on error

## Configuration (environment variables)

| Variable | Required | Description |
|---|---|---|
| `EKAI_PORTAL_URL` | ✅ | e.g. `https://support.ekai.ai` |
| `EKAI_CUSTOMER_ID` | ✅ | Your organisation ID in the portal |
| `EKAI_API_KEY` | ✅ | Generated in Admin → Environments |
| `EKAI_ENVIRONMENT` | | `production` / `staging` / `dev` (default: `production`) |
| `EKAI_CLOUD` | | `aws` / `azure` / `gcp` / `other` (default: `other`) |
| `EKAI_REGION` | | e.g. `eu-west-1` |
| `EKAI_AGENT_VERSION` | | e.g. `1.0.0` |
| `EKAI_SERVICES` | | JSON array of service probes (see below) |
| `EKAI_PUSH_INTERVAL` | | Seconds between pushes (default: `300`) |

## EKAI_SERVICES format

```json
[
  {
    "name": "ekai-api",
    "type": "api",
    "health_url": "http://localhost:8080/health",
    "timeout_seconds": 5
  },
  {
    "name": "ekai-db",
    "type": "database",
    "health_url": "db-host:5432",
    "timeout_seconds": 3
  },
  {
    "name": "ekai-cache",
    "type": "cache",
    "health_url": "redis-host:6379",
    "timeout_seconds": 2
  }
]
```

Service types: `api` | `worker` | `database` | `cache` | `queue` | `other`

Status thresholds:
- **healthy**: HTTP 200 and latency < 500 ms (or TCP connect OK)
- **degraded**: non-500 HTTP error, or latency 500 ms – 2 s
- **down**: timeout, connection refused, or HTTP 5xx

---

## Deployment options

### 1. Docker (any cloud)

```bash
docker run -d --restart unless-stopped \
  -e EKAI_PORTAL_URL=https://support.ekai.ai \
  -e EKAI_CUSTOMER_ID=your-org-id \
  -e EKAI_API_KEY=ek_live_your_key_here \
  -e EKAI_ENVIRONMENT=production \
  -e EKAI_CLOUD=aws \
  -e EKAI_REGION=eu-west-1 \
  -e EKAI_AGENT_VERSION=1.0.0 \
  -e EKAI_SERVICES='[{"name":"ekai-api","type":"api","health_url":"http://localhost:8080/health"}]' \
  ghcr.io/ekai/health-agent:latest
```

### 2. AWS — ECS Task + EventBridge Scheduler

Create a Task Definition that uses the Docker image above with the env vars
set as ECS task environment variables or Secrets Manager references.

Then create an EventBridge Scheduler rule with a `rate(5 minutes)` schedule
targeting the ECS task. The agent loops internally, so you only need one
long-running ECS task, not a scheduled task per push.

### 3. Azure Container Instance

```bash
az container create \
  --resource-group myResourceGroup \
  --name ekai-health-agent \
  --image ghcr.io/ekai/health-agent:latest \
  --restart-policy Always \
  --environment-variables \
    EKAI_PORTAL_URL=https://support.ekai.ai \
    EKAI_CUSTOMER_ID=your-org-id \
    EKAI_ENVIRONMENT=production \
  --secure-environment-variables \
    EKAI_API_KEY=ek_live_your_key_here
```

### 4. GCP — Cloud Run Job + Cloud Scheduler

```bash
gcloud run jobs create ekai-health-agent \
  --image ghcr.io/ekai/health-agent:latest \
  --region europe-west1 \
  --set-env-vars EKAI_PORTAL_URL=https://support.ekai.ai,...
```

Create a Cloud Scheduler job with `*/5 * * * *` to trigger it. Since the
container loops, you should use `--task-timeout=86400` and a single task count.

### 5. Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ekai-health-agent
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: agent
            image: ghcr.io/ekai/health-agent:latest
            env:
            - name: EKAI_PORTAL_URL
              value: "https://support.ekai.ai"
            - name: EKAI_CUSTOMER_ID
              value: "your-org-id"
            - name: EKAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: ekai-secrets
                  key: api-key
            - name: EKAI_ENVIRONMENT
              value: "production"
            - name: EKAI_CLOUD
              value: "aws"
            - name: EKAI_REGION
              value: "eu-west-1"
            - name: EKAI_SERVICES
              value: '[{"name":"ekai-api","type":"api","health_url":"http://ekai-api:8080/health"}]'
```

> **Tip:** For Kubernetes, run the agent as a long-lived Deployment (not CronJob)
> since it loops internally — this avoids CronJob scheduling overhead.

### 6. Linux VM / bare metal

```bash
# Install
pip3 install requests psutil
curl -o /opt/ekai/health-agent.py \
  https://raw.githubusercontent.com/ekai/health-agent/main/health-agent.py

# Add to crontab (or run as a systemd service for better reliability)
# The agent loops; crontab is a fallback restart mechanism
@reboot EKAI_PORTAL_URL=https://support.ekai.ai \
        EKAI_API_KEY=ek_live_... \
        EKAI_CUSTOMER_ID=... \
        python3 /opt/ekai/health-agent.py >> /var/log/ekai-agent.log 2>&1
```
