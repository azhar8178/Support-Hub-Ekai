# Ekai — Deployment Guide

This guide covers every supported deployment path for Ekai: self-hosted on a bare-metal server or VM, Docker Compose for a single-host production setup, and Kubernetes for multi-replica cloud deployments. Read through the [Prerequisites](#prerequisites) and [Environment Variables Reference](#environment-variables-reference) sections first regardless of which path you choose.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Environment variables reference](#environment-variables-reference)
4. [Database setup](#database-setup)
5. [Clerk authentication setup](#clerk-authentication-setup)
6. [Email (AWS SES)](#email-aws-ses)
7. [Object storage (Google Cloud Storage)](#object-storage-google-cloud-storage)
8. [Self-hosted (bare metal / VM)](#self-hosted-bare-metal--vm)
9. [Docker Compose](#docker-compose)
10. [Testing the stack](#testing-the-stack)
11. [Kubernetes](#kubernetes)
12. [Fleet monitoring](#fleet-monitoring)
13. [Health check endpoint](#health-check-endpoint)
14. [Upgrading](#upgrading)
15. [Troubleshooting](#troubleshooting)

---

## Architecture overview

```
                         ┌─────────────────────────────────┐
  Browser / Mobile App   │         Support Portal           │
  ──────────────────►    │  React SPA (nginx or vite serve)  │
                         └──────────────┬──────────────────┘
                                        │  /api/*  proxy
                         ┌──────────────▼──────────────────┐
                         │          API Server              │
                         │   Express 5 · Node 24 · ESM      │
                         │                                  │
                         │  • REST endpoints (Clerk auth)   │
                         │  • Background sweeps (60 s tick) │
                         │  • Fleet poll / alert sweep      │
                         └──────────────┬──────────────────┘
                                        │
                         ┌──────────────▼──────────────────┐
                         │          PostgreSQL 16            │
                         └─────────────────────────────────┘
```

**API Server** — the only stateful service. It:
- Serves all REST endpoints under `/api/`
- Runs background sweeps every 60 seconds (SLA alerts, auto-escalation, auto-close, fleet health checks)
- Optionally pushes its own health to a remote fleet hub (push mode)

**Support Portal** — a fully static React SPA. After `vite build` it is a directory of HTML/JS/CSS files that any web server can serve. nginx is the recommended server; it also proxies `/api/*` to the API server.

**PostgreSQL 16** — the single source of truth. All schema is managed by Drizzle ORM; there are no raw migration files.

---

## Prerequisites

| Dependency | Minimum version | Notes |
|---|---|---|
| Node.js | 24 | LTS recommended |
| pnpm | 10 | `npm install -g pnpm` or `corepack enable` |
| PostgreSQL | 16 | 15 may work but is untested |
| Docker | 26 | Compose deployments only |
| kubectl + helm | any current | Kubernetes deployments only |

---

## Environment variables reference

### API Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | ✅ | — | TCP port the HTTP server listens on |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/ekai` |
| `CLERK_PUBLISHABLE_KEY` | ✅ | — | Clerk publishable key (`pk_live_…` or `pk_test_…`) |
| `CLERK_SECRET_KEY` | ✅ | — | Clerk secret key (`sk_live_…` or `sk_test_…`) |
| `PORTAL_URL` | ✅ | — | Public URL of the support portal, used in notification email links |
| `NODE_ENV` | — | `development` | Set to `production` for all deployments |
| `LOG_LEVEL` | — | `info` | Pino log level: `fatal` `error` `warn` `info` `debug` `trace` |
| `AWS_ACCESS_KEY_ID` | — | — | AWS credentials for SES email. All three AWS vars must be set to enable email |
| `AWS_SECRET_ACCESS_KEY` | — | — | ↑ |
| `AWS_REGION` | — | `us-east-1` | AWS region for SES |
| `EMAIL_FROM` | — | — | Verified SES sender address, e.g. `support@yourcompany.com` |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | — | — | GCS bucket name. If unset, attachments are stored as base64 in Postgres (≤5 MB) |
| `PRIVATE_OBJECT_DIR` | — | — | Prefix/path inside the GCS bucket for private attachments |
| `FLEET_HUB_URL` | — | — | Push mode only — base URL of the Ekai hub this deployment reports to |
| `FLEET_API_KEY` | — | — | Push mode only — API key issued by the hub admin (see [Fleet monitoring](#fleet-monitoring)) |

### Support Portal (build-time)

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | ✅ | — | Port for `vite dev` / `vite preview`. Not needed after `vite build` (nginx ignores it) |
| `BASE_PATH` | ✅ | — | URL base path for the SPA, e.g. `/`. Must match the path your reverse proxy serves the portal at |
| `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | — | Same value as the API server's `CLERK_PUBLISHABLE_KEY`. Embedded into the JS bundle at build time |

> **Note:** `VITE_*` variables are embedded into the compiled JavaScript bundle at `vite build` time. Changing them after the build has no effect — you must rebuild the portal.

---

## Database setup

Ekai uses [Drizzle ORM](https://orm.drizzle.team/) with `drizzle-kit push` to synchronise the schema. There are no numbered migration files; the schema is always defined in code.

### First run (interactive — recommended for production upgrades)

```bash
# From the repo root, with the database reachable from your machine
DATABASE_URL="postgres://user:pass@host:5432/ekai" \
  pnpm --filter @workspace/db run push
```

Drizzle prints a diff of every DDL statement it will execute and asks for confirmation before applying. This creates all tables, indexes, and constraints. It is safe to run multiple times.

### Non-interactive (CI / Docker)

```bash
DATABASE_URL="postgres://user:pass@host:5432/ekai" \
  pnpm --filter @workspace/db run push-force
```

The `push-force` script adds `--force` to skip the confirmation prompt. Use this in automated pipelines. The Docker Compose `migrator` service runs this automatically before the API server starts.

### On upgrade

Run one of the commands above after pulling new code. Drizzle detects schema differences and applies only the necessary DDL.

> ⚠️ **Drizzle push is not zero-downtime for destructive changes** (column renames, type changes). Review the interactive diff carefully and take a database backup before upgrading in production.

---

## Clerk authentication setup

Ekai uses [Clerk](https://clerk.com) for authentication. Every user account must exist in both Clerk and the Ekai `users` table; new users are invited via the portal admin UI.

1. Create a Clerk application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. Under **API Keys**, copy the **Publishable key** and **Secret key**.
3. Under **Paths → Sign-in URL**, set it to your portal's sign-in page (e.g. `https://support.yourcompany.com/auth`).
4. Under **Allowlist**, add your portal domain if you want to restrict sign-ups.
5. Set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` on the API server, and `VITE_CLERK_PUBLISHABLE_KEY` (same value as the publishable key) at portal build time.

---

## Email (AWS SES)

Email notifications are optional. When all three AWS variables are set (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM`), the API server sends emails for ticket updates, invites, and SLA warnings.

1. Verify your sender domain or address in the [SES console](https://console.aws.amazon.com/ses/).
2. Create an IAM user with `ses:SendRawEmail` permission.
3. Generate access key credentials for that user.
4. Set the four variables in the API server's environment.

If the variables are absent, email is silently disabled — the application runs normally without it.

---

## Object storage (Google Cloud Storage)

By default, file attachments are stored as base64 in PostgreSQL with a 5 MB cap per file. To support larger files and better performance, configure Google Cloud Storage:

1. Create a GCS bucket. Make it **private** (no public access).
2. Grant the API server's service account `storage.objectAdmin` on the bucket.
   - On GKE: use [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity).
   - Elsewhere: create a service-account key and mount it; set `GOOGLE_APPLICATION_CREDENTIALS` to the key file path.
3. Set `DEFAULT_OBJECT_STORAGE_BUCKET_ID` to the bucket name.
4. Optionally set `PRIVATE_OBJECT_DIR` to a path prefix (e.g. `attachments`).

---

## Self-hosted (bare metal / VM)

### 1. Install dependencies

```bash
# Node 24 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 24
nvm use 24

# pnpm
corepack enable
corepack prepare pnpm@latest --activate
```

### 2. Clone and install

```bash
git clone https://github.com/your-org/ekai.git
cd ekai
pnpm install --frozen-lockfile
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your values — DATABASE_URL, CLERK_*, etc.
```

### 4. Push the database schema

```bash
source .env   # or export DATABASE_URL=... manually
pnpm --filter @workspace/db run push
```

### 5. Build the API server

```bash
pnpm --filter @workspace/api-server run build
# Output: artifacts/api-server/dist/index.mjs
```

### 6. Build the support portal

```bash
export PORT=3001            # required by vite.config.ts even for builds
export BASE_PATH=/
export VITE_CLERK_PUBLISHABLE_KEY=pk_live_...

pnpm --filter @workspace/support-portal run build
# Output: artifacts/support-portal/dist/public/
```

### 7. Start the API server

```bash
NODE_ENV=production \
PORT=8080 \
DATABASE_URL=postgres://... \
CLERK_PUBLISHABLE_KEY=pk_live_... \
CLERK_SECRET_KEY=sk_live_... \
PORTAL_URL=https://support.yourcompany.com \
  node --enable-source-maps artifacts/api-server/dist/index.mjs
```

Use a process manager (systemd, PM2, supervisor) to keep it running.

**systemd unit example** (`/etc/systemd/system/ekai-api.service`):

```ini
[Unit]
Description=Ekai API Server
After=network.target postgresql.service

[Service]
Type=simple
User=ekai
WorkingDirectory=/opt/ekai
EnvironmentFile=/opt/ekai/.env
ExecStart=/usr/bin/node --enable-source-maps artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ekai-api
```

### 8. Serve the support portal

Point nginx at `artifacts/support-portal/dist/public/` and proxy `/api` to the API server.

**nginx site config** (`/etc/nginx/sites-available/ekai`):

```nginx
server {
    listen 443 ssl;
    server_name support.yourcompany.com;

    ssl_certificate     /etc/letsencrypt/live/support.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/support.yourcompany.com/privkey.pem;

    root /opt/ekai/artifacts/support-portal/dist/public;
    index index.html;

    # Proxy API calls to the backend
    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-Proto $scheme;
        client_max_body_size 100m;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Docker Compose

Docker Compose brings up Postgres, the API server, and the portal in one command.

### Quick start

```bash
# 1. Copy and edit the environment file
cp .env.example .env
nano .env   # fill in POSTGRES_PASSWORD, CLERK_*, etc.

# 2. Validate required variables before starting (catches missing config early)
set -a; source .env; set +a
./scripts/check-env.sh

# 3. Build images and start services
docker compose up -d --build

# 4. Check logs
docker compose logs -f api-server
```

The portal is available at `http://localhost:80` (or the `PORTAL_PORT` you set in `.env`). The API server is at `http://localhost:8080`.

### Services

| Service | Internal address | Host port (default) |
|---|---|---|
| `postgres` | `postgres:5432` | — (not exposed to host) |
| `api-server` | `api-server:8080` | `8080` |
| `portal` | `portal:80` | `80` |

### Custom port mapping

```bash
# In .env
API_PORT=9090
PORTAL_PORT=8443
```

### Database migration

Schema migration is handled automatically by the `migrator` service. On every `docker compose up`, the `migrator` container runs `drizzle-kit push --force` against the database and exits before the API server or portal start. You do not need to run any migration command manually.

If you need to inspect the schema diff interactively (recommended before production upgrades), run the migration from your host machine while Postgres is running:

```bash
source .env
DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}" \
  pnpm --filter @workspace/db run push
```

### Rebuilding after code changes

```bash
docker compose up -d --build api-server portal
```

---

## Testing the stack

Use the smoke-test script to verify that a schema migration succeeds on a clean database and that the API server comes up healthy. Run this locally before pushing a schema change, and add it to your CI pipeline to catch broken migrations before they reach production.

```bash
./scripts/smoke-test-compose.sh
```

The script:

1. Builds the `migrator` and `api-server` images from the local source tree.
2. Starts a fresh Postgres instance with an empty database (an isolated Docker volume scoped to the test run).
3. Runs the `migrator` service (`drizzle-kit push --force`) and **fails immediately** if it exits non-zero.
4. Polls `GET /api/healthz` on the API server until it returns HTTP 200.
5. Tears everything down (including the ephemeral volume) on exit — whether the test passed or failed.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | `smoke-test-secret` | Password for the test Postgres instance |
| `API_PORT` | `18080` | Host port for the API server (avoids clashing with a dev stack on 8080) |
| `WAIT_SECS` | `120` | Seconds to wait for the API server to become healthy |
| `COMPOSE_PROJECT` | `ekai-smoke` | Docker Compose project name (keeps test containers isolated) |
| `CLERK_PUBLISHABLE_KEY` | stub value | Stub Clerk key — `/api/healthz` does not require real auth |
| `CLERK_SECRET_KEY` | stub value | ↑ |

To run with real Clerk credentials (e.g. to test authenticated flows after smoke testing):

```bash
CLERK_PUBLISHABLE_KEY=pk_test_... \
CLERK_SECRET_KEY=sk_test_... \
./scripts/smoke-test-compose.sh
```

### Running in CI (GitHub Actions example)

```yaml
- name: Smoke-test Docker Compose stack
  run: ./scripts/smoke-test-compose.sh
```

No additional setup is required — Docker is available by default on all GitHub-hosted runners. The script uses a unique Compose project name (`ekai-smoke`) so it does not interfere with other services running on the same host.

---

## Kubernetes

The manifests in `deploy/k8s/` target a standard Kubernetes cluster with an nginx ingress controller. They have been tested on EKS (AWS), AKS (Azure), and GKE (Google Cloud).

### Directory layout

```
deploy/k8s/
├── api-server.yaml     # Secret, ConfigMap, Deployment, Service, HPA
└── support-portal.yaml # ConfigMap (nginx config), Deployment, Service, Ingress
```

### Step-by-step

#### 1. Build and push images

The API server Dockerfile has two relevant build targets:
- **`runtime`** (default) — slim production image, no schema sources or drizzle-kit
- **`migrator`** — contains `lib/db/` sources and drizzle-kit; runs `push-force` on start

```bash
TAG=$(git rev-parse --short HEAD)

# API server runtime image
docker build \
  -f artifacts/api-server/Dockerfile \
  -t your-registry/ekai-api-server:${TAG} \
  .
docker push your-registry/ekai-api-server:${TAG}

# Migrator image (separate target from the same Dockerfile)
docker build \
  -f artifacts/api-server/Dockerfile \
  --target migrator \
  -t your-registry/ekai-migrate:${TAG} \
  .
docker push your-registry/ekai-migrate:${TAG}

# Support portal (Clerk key and BASE_PATH are baked in at build time)
docker build \
  -f artifacts/support-portal/Dockerfile \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_... \
  --build-arg BASE_PATH=/ \
  -t your-registry/ekai-portal:${TAG} \
  .
docker push your-registry/ekai-portal:${TAG}
```

#### 2. Create the namespace

```bash
kubectl create namespace ekai
```

#### 3. Populate secrets

Edit `deploy/k8s/api-server.yaml` and replace every `<base64-encoded-…>` placeholder:

```bash
echo -n "sk_live_..." | base64    # CLERK_SECRET_KEY
echo -n "postgres://..."  | base64 # DATABASE_URL
# etc.
```

#### 4. Update image references

In both YAML files, replace `your-registry/ekai-api-server:latest` (and the portal equivalent) with the tags you pushed in step 1.

#### 5. Update hostnames

In `support-portal.yaml`, replace `support.yourcompany.com` with your real domain in the Ingress spec.

#### 6. Apply manifests

```bash
kubectl apply -f deploy/k8s/api-server.yaml
kubectl apply -f deploy/k8s/support-portal.yaml
```

#### 7. Push the database schema

Use the dedicated `migrator` image (built with `--target migrator` in step 1). It contains the schema sources and `drizzle-kit` — the runtime image does not.

```bash
kubectl run ekai-migrate --rm -it --restart=Never \
  --image=your-registry/ekai-migrate:${TAG} \
  --env="DATABASE_URL=postgres://user:pass@your-db-host:5432/ekai" \
  -n ekai
```

The container runs `drizzle-kit push --force` and exits. Re-run this job on every upgrade before rolling out new API server pods.

#### 8. Verify

```bash
kubectl get pods -n ekai
kubectl logs -n ekai -l app=ekai-api-server
curl https://support.yourcompany.com/api/healthz
```

### Horizontal scaling

The API server is stateless beyond the database and can be scaled freely:

```bash
kubectl scale deployment ekai-api-server -n ekai --replicas=4
```

The included HorizontalPodAutoscaler in `api-server.yaml` auto-scales based on CPU utilisation (70% target).

> **Note on background sweeps:** The fleet poll and SLA sweeps run in every API server pod. For large deployments, consider setting `FLEET_POLL_INTERVAL_MS` higher or externalising sweeps to a dedicated worker pod.

---

## Fleet monitoring

Ekai includes a built-in fleet health dashboard that monitors client Ekai deployments from a central hub.

### Poll mode (default — no client configuration)

By default, the hub polls each registered deployment's `GET /api/healthz` endpoint every 5 minutes. No environment variables need to be set on the client deployment.

To register a client deployment:
1. In the support portal, go to **Admin → Fleet**.
2. Click **Register deployment** and enter a name and the base URL of the client instance (e.g. `https://client.example.com`).
3. The hub will begin polling within 5 minutes.

Use this mode for any deployment the hub can reach over the network (public internet or shared VPN).

### Push mode (opt-in — for air-gapped / private deployments)

If the client deployment is in a private network that the hub cannot reach (e.g. behind a corporate firewall with no inbound rules), switch it to push mode:

1. In the fleet UI, click the **Hub polls** badge next to the deployment and switch to **Client pushes**.
2. Copy the displayed API key (shown once).
3. On the client deployment, set two environment variables and restart the API server:

```bash
FLEET_HUB_URL=https://support.yourcompany.com   # URL of the hub
FLEET_API_KEY=<key-from-step-2>
```

The client will then push a heartbeat to the hub every 5 minutes automatically.

### Alert thresholds

| Condition | Trigger | Alert cooldown |
|---|---|---|
| No heartbeat | 10 minutes without a successful check | 30 minutes |
| DB degraded | `db.status == "degraded"` in health JSON | 30 minutes |

Alerts are sent to the deployment's configured Slack webhook (configurable per-deployment in the fleet UI) and as in-app push notifications to all admin users.

---

## Health check endpoint

`GET /api/healthz` — unauthenticated, safe to expose to load balancers and monitoring systems.

**Response (200 OK):**

```json
{
  "status": "healthy",
  "timestamp": "2026-07-13T12:00:00.000Z",
  "db": {
    "status": "healthy",
    "latencyMs": 3
  },
  "pushQueueDepth": 0,
  "slaBreachCount": 0,
  "openTicketCount": 42,
  "emailConfigured": true,
  "storageConfigured": false
}
```

| Field | Values | Meaning |
|---|---|---|
| `status` | `healthy` `degraded` `offline` | Overall instance health |
| `db.status` | `healthy` `degraded` | Database reachability |
| `db.latencyMs` | integer ms or `null` | Round-trip time for `SELECT 1` |
| `emailConfigured` | boolean | Whether AWS SES env vars are set |
| `storageConfigured` | boolean | Whether GCS env vars are set |

**Kubernetes probe configuration:**

```yaml
livenessProbe:
  httpGet:
    path: /api/healthz
    port: 8080
  initialDelaySeconds: 20
  periodSeconds: 30
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/healthz
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 2
```

---

## Upgrading

1. **Back up the database** before every upgrade:
   ```bash
   pg_dump -Fc -d "$DATABASE_URL" -f ekai-backup-$(date +%Y%m%d).dump
   ```

2. Pull the new code:
   ```bash
   git pull
   pnpm install --frozen-lockfile
   ```

3. Push schema changes (inspect the diff before confirming):
   ```bash
   DATABASE_URL=... pnpm --filter @workspace/db run push
   ```

4. Rebuild and restart:
   - **Self-hosted:** `pnpm --filter @workspace/api-server run build && systemctl restart ekai-api`
   - **Docker Compose:** `docker compose up -d --build`
   - **Kubernetes:** Build new images → update Deployment image tags → `kubectl rollout status`

---

## Troubleshooting

### API server fails to start: "PORT environment variable is required"

The `PORT` variable is mandatory. Set it before starting the process:
```bash
PORT=8080 node --enable-source-maps artifacts/api-server/dist/index.mjs
```

### `DATABASE_URL, ensure the database is provisioned`

The API server or `drizzle-kit push` cannot connect to Postgres. Check:
- The connection string format: `postgres://user:password@host:5432/dbname`
- Postgres is running and accepting connections on the specified host/port
- The user has `CREATE TABLE` privileges
- Firewall / security-group rules allow the connection

### Portal shows a blank page / 404 on all routes

The `BASE_PATH` build argument must match the URL path prefix the web server uses to serve the portal. If the portal is served at the root, use `BASE_PATH=/`. If it is served at `/portal`, use `BASE_PATH=/portal` and rebuild the image.

### Clerk auth errors: "Unauthorized" on every request

- Confirm `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set on the API server.
- Confirm `VITE_CLERK_PUBLISHABLE_KEY` was set at portal **build** time (not at runtime).
- The publishable key in the portal JS bundle must match the one on the API server.
- Ensure `PORTAL_URL` is listed as an allowed origin in your Clerk dashboard.

### Fleet deployment shows "offline" immediately after registration

- **Poll mode:** The hub polls on a 5-minute schedule. Wait one cycle. If still offline, check that the deployment URL is reachable from the hub (test with `curl <url>/api/healthz`).
- **Push mode:** Verify `FLEET_HUB_URL` and `FLEET_API_KEY` are set correctly on the client and the process was restarted. Check client API server logs for heartbeat push errors.

### Emails are not being sent

- Confirm all three required email variables are set: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM`.
- Verify the SES sender domain/address is verified in the AWS console.
- Check that the IAM user has `ses:SendRawEmail` permission.
- In SES sandbox mode, recipient addresses must also be verified. [Move out of sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) for production use.
