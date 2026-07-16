# Ekai Fleet Agent

A lightweight agent that runs alongside each Ekai installation and pushes
health heartbeats to the Ekai support portal every 5 minutes.

## How it works

1. Calls `GET $EKAI_HEALTH_URL` (the local Ekai API health endpoint)
2. Forwards the result to `POST $FLEET_HUB_URL/api/fleet/heartbeat`
3. The support portal updates the environment status in real time

## Setup (per customer environment)

### 1 — Register the environment in the support portal

Go to **Admin → Environments → New environment**, fill in the name and
organisation, set mode to **Client Push**, and save. Copy the generated
`FLEET_API_KEY` — you'll need it below.

### 2 — Build the Docker image

```bash
docker build -t your-registry/ekai-fleet-agent:latest deploy/fleet-agent/
docker push your-registry/ekai-fleet-agent:latest
```

### 3 — Deploy alongside Ekai

Pick the deployment model that matches the customer's environment:

| Environment   | Use                          |
|---------------|------------------------------|
| Kubernetes    | `k8s-cronjob.yaml`           |
| Docker        | `docker-compose.example.yml` |
| VM / bare metal | cron job (see below)       |

**Kubernetes**
```bash
kubectl create secret generic ekai-fleet-secret \
  --from-literal=api-key=ek_fleet_<...> \
  -n <ekai-namespace>

kubectl apply -f deploy/fleet-agent/k8s-cronjob.yaml -n <ekai-namespace>
```

**VM / bare metal** — add to crontab:
```cron
*/5 * * * * FLEET_HUB_URL=https://dev.ekai.ai FLEET_API_KEY=ek_fleet_<...> EKAI_HEALTH_URL=http://localhost:8080/api/healthz /path/to/agent.sh >> /var/log/ekai-fleet-agent.log 2>&1
```

## Environment variables

| Variable          | Required | Description                                         |
|-------------------|----------|-----------------------------------------------------|
| `FLEET_HUB_URL`   | Yes      | Ekai support portal URL (same for every customer)   |
| `FLEET_API_KEY`   | Yes      | Per-environment key from Admin → Environments       |
| `EKAI_HEALTH_URL` | Yes      | Internal URL to Ekai's `/api/healthz` endpoint      |

## Troubleshooting

- **HTTP 401** — API key is wrong or the environment record was deleted
- **HTTP 400 "Timestamp drift"** — server clock is off by >10 min; fix NTP
- **HTTP 429** — agent is running more often than once per 60 seconds; check cron
- **`000` / connection refused** — `EKAI_HEALTH_URL` is unreachable; check service name / port
