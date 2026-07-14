# Ekai — Deployment Guide

This guide covers every supported deployment path for Ekai: Ubuntu + Docker (the recommended self-hosted path), Docker Compose on any host, bare-metal VM, and Kubernetes for multi-replica cloud deployments.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Authentication](#authentication)
3. [Prerequisites](#prerequisites)
4. [Environment variables reference](#environment-variables-reference)
5. [Database setup](#database-setup)
6. [Ubuntu + Docker (recommended)](#ubuntu--docker-recommended)
7. [Docker Compose (any host)](#docker-compose)
8. [Self-hosted (bare metal / VM)](#self-hosted-bare-metal--vm)
9. [Email (AWS SES)](#email-aws-ses)
10. [Object storage (Google Cloud Storage)](#object-storage-google-cloud-storage)
11. [Testing the stack](#testing-the-stack)
12. [Kubernetes](#kubernetes)
13. [Fleet monitoring](#fleet-monitoring)
14. [Health check endpoint](#health-check-endpoint)
15. [Upgrading](#upgrading)
16. [Troubleshooting](#troubleshooting)

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
                         │  • REST endpoints (session auth) │
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

**Support Portal** — a fully static React SPA. After `vite build` it is a directory of HTML/JS/CSS files that any web server can serve. nginx is the recommended server; it also proxies `/api/*` to the API server.

**PostgreSQL 16** — the single source of truth. All schema is managed by Drizzle ORM; there are no raw migration files.

---

## Authentication

Ekai supports two authentication modes selected at deploy time via the `AUTH_MODE` environment variable.

### Local mode (`AUTH_MODE=local`) — recommended for self-hosting

Built-in email + password authentication. No external accounts or services needed.

- Sessions are stored in PostgreSQL (auto-created `session` table), so they survive server restarts.
- Passwords are hashed with bcrypt (cost factor 12).
- Requires `SESSION_SECRET` — a 32-byte random hex string.
- The first admin account is created via the [bootstrap endpoint](#first-admin-bootstrap).

### Clerk mode (`AUTH_MODE=clerk`)

Delegates authentication to [Clerk](https://clerk.com). Users sign in via Clerk's hosted UI and are linked to portal records by email. Requires `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the Clerk dashboard.

> The portal is built with the auth mode baked in at **build time** (`VITE_AUTH_MODE`). The build arg must match the API server's `AUTH_MODE` at runtime. Mismatching them will break the login flow.

---

## Prerequisites

| Dependency | Minimum version | Notes |
|---|---|---|
| Node.js | 24 | LTS recommended |
| pnpm | 10 | `npm install -g pnpm` or `corepack enable` |
| PostgreSQL | 16 | 15 may work but is untested |
| Docker | 26 | Docker Compose deployments |
| Docker Compose | v2 | Bundled with Docker Desktop; `docker compose` (not `docker-compose`) |
| kubectl + helm | any current | Kubernetes deployments only |

---

## Environment variables reference

### API Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | ✅ | — | TCP port the HTTP server listens on |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `PORTAL_URL` | ✅ | — | Public URL of the support portal (used in email links and CORS) |
| `AUTH_MODE` | — | `local` | `local` or `clerk` |
| `SESSION_SECRET` | local✅ | — | Random 32-byte hex secret for session cookies. Generate: `openssl rand -hex 32` |
| `CLERK_PUBLISHABLE_KEY` | clerk✅ | — | Clerk publishable key (`pk_live_…` or `pk_test_…`) |
| `CLERK_SECRET_KEY` | clerk✅ | — | Clerk secret key (`sk_live_…`) |
| `NODE_ENV` | — | `development` | Set to `production` for all deployments |
| `LOG_LEVEL` | — | `info` | Pino log level: `fatal` `error` `warn` `info` `debug` `trace` |
| `AWS_ACCESS_KEY_ID` | — | — | AWS credentials for SES email. All three AWS vars must be set to enable email |
| `AWS_SECRET_ACCESS_KEY` | — | — | ↑ |
| `AWS_REGION` | — | `us-east-1` | AWS region for SES |
| `EMAIL_FROM` | — | — | Verified SES sender address |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | — | — | GCS bucket name. If unset, attachments stored as base64 in Postgres (≤5 MB) |
| `PRIVATE_OBJECT_DIR` | — | — | Prefix/path inside the GCS bucket for private attachments |
| `FLEET_HUB_URL` | — | — | Push mode only — base URL of the Ekai hub this deployment reports to |
| `FLEET_API_KEY` | — | — | Push mode only — API key issued by the hub admin |

### Support Portal (build-time)

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | ✅ | — | Port for `vite dev` / `vite preview`. Not needed after `vite build` |
| `BASE_PATH` | ✅ | — | URL base path for the SPA, e.g. `/` |
| `VITE_AUTH_MODE` | — | `clerk` | Must match the API server's `AUTH_MODE`. Set to `local` for self-hosted builds |
| `VITE_CLERK_PUBLISHABLE_KEY` | clerk✅ | — | Same as `CLERK_PUBLISHABLE_KEY`. Embedded into the JS bundle at build time |

> **Note:** `VITE_*` variables are embedded into the compiled JavaScript bundle at `vite build` time. Changing them after the build has no effect — you must rebuild the portal.

---

## Database setup

Ekai uses [Drizzle ORM](https://orm.drizzle.team/) with `drizzle-kit push` to synchronise the schema. There are no numbered migration files; the schema is always defined in code.

### First run

```bash
DATABASE_URL="postgres://user:pass@host:5432/ekai" \
  pnpm --filter @workspace/db run push
```

Drizzle prints a diff of every DDL statement and asks for confirmation. Safe to run multiple times.

### Non-interactive (CI / Docker)

```bash
DATABASE_URL="postgres://user:pass@host:5432/ekai" \
  pnpm --filter @workspace/db run push-force
```

The Docker Compose `migrator` service runs this automatically before the API server starts.

### On upgrade

Run the push command after pulling new code. Drizzle applies only the necessary DDL.

> ⚠️ **Drizzle push is not zero-downtime for destructive changes.** Review the interactive diff carefully and take a database backup before upgrading in production.

---

## First admin bootstrap

After the API server starts for the first time (empty database), create the first admin account:

**Step 1 — Get the bootstrap token from the server logs:**

```bash
# Docker Compose
docker compose logs api-server | grep bootstrapToken

# systemd
journalctl -u ekai-api | grep bootstrapToken
```

**Step 2 — Call the bootstrap endpoint:**

```bash
curl -s -X POST http://localhost:8080/api/bootstrap-admin \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "you@yourcompany.com",
    "bootstrapToken": "<token-from-logs>"
  }' | jq .
```

**Local mode** — the response contains `initialPassword`. Use it to sign in immediately:

```json
{
  "email": "you@yourcompany.com",
  "initialPassword": "abc123...",
  "loginUrl": "https://support.yourcompany.com"
}
```

**Clerk mode** — the response contains `inviteUrl`. Visit it to complete sign-up via Clerk.

> The bootstrap endpoint permanently returns 404 once the first admin has completed setup. It re-enables on every server restart (new token), but only until an admin is configured.

---

## Ubuntu + Docker (recommended)

This is the recommended path for self-hosting on a fresh Ubuntu 22.04 / 24.04 instance.

### 1. Install Docker

```bash
# Update apt and install prerequisites
sudo apt-get update
sudo apt-get install -y ca-certificates curl

# Add Docker's official GPG key and repo
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Allow running Docker without sudo (log out and back in after this)
sudo usermod -aG docker $USER
```

Verify:

```bash
docker --version        # Docker version 26.x.x
docker compose version  # Docker Compose version v2.x.x
```

### 2. Clone the repository

```bash
sudo mkdir -p /opt/ekai
sudo chown $USER:$USER /opt/ekai
git clone https://github.com/your-org/ekai.git /opt/ekai
cd /opt/ekai
```

### 3. Configure environment

```bash
cp .env.example .env
nano .env
```

Fill in these values at minimum:

```dotenv
# Database
POSTGRES_PASSWORD=<strong-random-password>

# Auth (local mode — no Clerk account needed)
AUTH_MODE=local
SESSION_SECRET=<output of: openssl rand -hex 32>

# Your server's public URL (used in emails and CORS)
PORTAL_URL=https://support.yourcompany.com
```

Generate the session secret:

```bash
openssl rand -hex 32
```

### 4. Validate config

```bash
./scripts/check-env.sh
```

### 5. Build and start

```bash
docker compose up -d --build
```

This will:
1. Pull `postgres:16-alpine`
2. Build the API server and portal images from source
3. Run the `migrator` to apply the database schema
4. Start the API server and portal

Check that everything is running:

```bash
docker compose ps
docker compose logs -f api-server
```

### 6. Bootstrap the first admin account

```bash
# Get the bootstrap token
docker compose logs api-server | grep bootstrapToken

# Create the admin user
curl -s -X POST http://localhost:8080/api/bootstrap-admin \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@yourcompany.com","bootstrapToken":"<token>"}' | jq .
```

Note the `initialPassword` in the response. Open `http://your-server-ip` and sign in.

**Change your password immediately** in Admin → Team after first login.

### 7. Configure SSL with Caddy (recommended)

Caddy automatically provisions Let's Encrypt certificates with zero configuration.

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddyfile
support.yourcompany.com {
    reverse_proxy localhost:80
}
```

```bash
sudo systemctl enable --now caddy
```

Caddy will obtain a TLS certificate automatically and renew it. Your portal is now available at `https://support.yourcompany.com`.

Alternatively, use **nginx** — see the [Self-hosted (bare metal / VM)](#self-hosted-bare-metal--vm) section for an example nginx config.

### 8. Auto-start on boot

Docker's `restart: unless-stopped` policy keeps containers running across reboots automatically when Docker itself is enabled:

```bash
sudo systemctl enable docker
```

No additional configuration needed.

### 9. Upgrading

```bash
cd /opt/ekai
git pull
docker compose up -d --build
```

The `migrator` service applies any schema changes automatically before the API server restarts.

---

## Docker Compose

Docker Compose brings up Postgres, the API server, and the portal in one command and works on any host with Docker installed.

### Quick start

```bash
# 1. Copy and edit the environment file
cp .env.example .env
nano .env   # fill in POSTGRES_PASSWORD, SESSION_SECRET, PORTAL_URL

# 2. Validate required variables before starting
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

Schema migration is handled automatically by the `migrator` service. On every `docker compose up`, the `migrator` container runs `drizzle-kit push --force` and exits before the API server or portal start.

### Rebuilding after code changes

```bash
docker compose up -d --build api-server portal
```

---

## Self-hosted (bare metal / VM)

### 1. Install dependencies

```bash
# Node 24 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 24 && nvm use 24

# pnpm
corepack enable && corepack prepare pnpm@latest --activate
```

### 2. Clone and install

```bash
git clone https://github.com/your-org/ekai.git && cd ekai
pnpm install --frozen-lockfile
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit: DATABASE_URL, AUTH_MODE, SESSION_SECRET, PORTAL_URL
```

### 4. Push the database schema

```bash
source .env
pnpm --filter @workspace/db run push
```

### 5. Build the API server

```bash
pnpm --filter @workspace/api-server run build
# Output: artifacts/api-server/dist/index.mjs
```

### 6. Build the support portal

```bash
export PORT=3001 BASE_PATH=/ VITE_AUTH_MODE=local
pnpm --filter @workspace/support-portal run build
# Output: artifacts/support-portal/dist/public/
```

### 7. Start the API server

```bash
NODE_ENV=production \
PORT=8080 \
AUTH_MODE=local \
SESSION_SECRET=<your-secret> \
DATABASE_URL=postgres://... \
PORTAL_URL=https://support.yourcompany.com \
  node --enable-source-maps artifacts/api-server/dist/index.mjs
```

**systemd unit** (`/etc/systemd/system/ekai-api.service`):

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
sudo systemctl daemon-reload && sudo systemctl enable --now ekai-api
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

    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-Proto $scheme;
        # Required for secure session cookies when behind a proxy
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        client_max_body_size 100m;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Email (AWS SES)

Email notifications are optional. When all three AWS variables are set (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM`), the API server sends emails for ticket updates and SLA warnings.

1. Verify your sender domain or address in the [SES console](https://console.aws.amazon.com/ses/).
2. Create an IAM user with `ses:SendRawEmail` permission.
3. Generate access key credentials for that user.
4. Set the four variables in the API server's environment.

If the variables are absent, email is silently disabled.

---

## Object storage (Google Cloud Storage)

By default, file attachments are stored as base64 in PostgreSQL with a 5 MB cap. To support larger files:

1. Create a private GCS bucket.
2. Grant the API server's service account `storage.objectAdmin` on the bucket.
3. Set `DEFAULT_OBJECT_STORAGE_BUCKET_ID` to the bucket name.
4. Optionally set `PRIVATE_OBJECT_DIR` to a path prefix (e.g. `attachments`).

---

## Testing the stack

```bash
./scripts/smoke-test-compose.sh
```

The script builds images, starts a fresh Postgres instance, runs the migrator, polls `GET /api/healthz` until healthy, then tears down.

---

## Kubernetes

The manifests in `deploy/k8s/` target a standard Kubernetes cluster with an nginx ingress controller.

### Step-by-step

#### 1. Build and push images

```bash
TAG=$(git rev-parse --short HEAD)

# API server runtime
docker build -f artifacts/api-server/Dockerfile \
  -t your-registry/ekai-api-server:${TAG} . && \
  docker push your-registry/ekai-api-server:${TAG}

# Migrator (separate build target)
docker build -f artifacts/api-server/Dockerfile --target migrator \
  -t your-registry/ekai-migrate:${TAG} . && \
  docker push your-registry/ekai-migrate:${TAG}

# Support portal — bake in auth mode at build time
docker build -f artifacts/support-portal/Dockerfile \
  --build-arg VITE_AUTH_MODE=local \
  --build-arg BASE_PATH=/ \
  -t your-registry/ekai-portal:${TAG} . && \
  docker push your-registry/ekai-portal:${TAG}
```

#### 2–7. Apply manifests

Follow the same steps as before (namespace, secrets, image refs, hostnames, `kubectl apply`). See [previous step-by-step](#step-by-step) for the full flow.

When populating the `api-server` Secret, set `AUTH_MODE=local` and `SESSION_SECRET` instead of Clerk keys:

```bash
echo -n "local" | base64          # AUTH_MODE
echo -n "<your-secret>" | base64  # SESSION_SECRET
```

### Helm chart

```bash
helm install ekai ./deploy/helm/ekai \
  --set api.image.tag="${TAG}" \
  --set portal.image.tag="${TAG}" \
  --set api.secrets.DATABASE_URL="postgres://user:pass@host:5432/ekai" \
  --set api.config.AUTH_MODE="local" \
  --set api.secrets.SESSION_SECRET="<your-secret>" \
  --set api.config.PORTAL_URL="https://support.yourcompany.com" \
  --set ingress.host="support.yourcompany.com"
```

---

## Fleet monitoring

Ekai includes a built-in fleet health dashboard that monitors remote Ekai installations from a central hub.

### Poll mode (default — no client configuration)

The hub polls each registered deployment's `GET /api/healthz` endpoint every 5 minutes. No environment variables need to be set on the client.

To register a client deployment:
1. In the support portal, go to **Admin → Fleet**.
2. Click **Register deployment** and enter a name and the base URL of the client instance.
3. The hub will begin polling within 5 minutes.

### Push mode (for air-gapped / private deployments)

If the client is behind a firewall the hub can't reach:

1. In the fleet UI, switch the deployment to **Client pushes**.
2. Copy the displayed API key.
3. On the client, set two environment variables and restart:

```bash
FLEET_HUB_URL=https://support.yourcompany.com
FLEET_API_KEY=<key-from-step-2>
```

The client pushes a heartbeat to the hub every 5 minutes automatically.

### Alert thresholds

| Condition | Trigger | Alert cooldown |
|---|---|---|
| No heartbeat | 10 minutes without a successful check | 30 minutes |
| DB degraded | `db.status == "degraded"` in health JSON | 30 minutes |

---

## Health check endpoint

`GET /api/healthz` — unauthenticated, safe to expose to load balancers and monitoring systems.

**Response (200 OK):**

```json
{
  "status": "healthy",
  "timestamp": "2026-07-14T12:00:00.000Z",
  "db": { "status": "healthy", "latencyMs": 3 },
  "openTicketCount": 42,
  "emailConfigured": true,
  "storageConfigured": false
}
```

---

## Upgrading

1. **Back up the database:**
   ```bash
   pg_dump -Fc -d "$DATABASE_URL" -f ekai-backup-$(date +%Y%m%d).dump
   ```

2. Pull new code and reinstall:
   ```bash
   git pull && pnpm install --frozen-lockfile
   ```

3. Apply schema changes:
   ```bash
   DATABASE_URL=... pnpm --filter @workspace/db run push
   ```

4. Rebuild and restart:
   - **Docker Compose:** `docker compose up -d --build`
   - **Bare metal:** rebuild + `systemctl restart ekai-api`
   - **Kubernetes (Helm):** `helm upgrade ekai ./deploy/helm/ekai -f my-values.yaml --set api.image.tag="${TAG}" --set portal.image.tag="${TAG}"`

---

## Troubleshooting

### API server fails to start: "SESSION_SECRET is required"

Running `AUTH_MODE=local` without a session secret set. Generate one:

```bash
openssl rand -hex 32
```

Add it to `.env` as `SESSION_SECRET=<value>`.

### Portal shows the Clerk login page instead of the password form (or vice versa)

The portal is compiled with a baked-in auth mode (`VITE_AUTH_MODE`). The build arg must match the API server's `AUTH_MODE`. Rebuild the portal image:

```bash
docker compose up -d --build portal
```

### API server fails to start: "PORT environment variable is required"

```bash
PORT=8080 node --enable-source-maps artifacts/api-server/dist/index.mjs
```

### `DATABASE_URL` connection error

Check the connection string format: `postgres://user:password@host:5432/dbname`. Verify Postgres is running and the user has `CREATE TABLE` privileges.

### Portal shows a blank page / 404 on all routes

The `BASE_PATH` build argument must match the URL path prefix the web server uses. If served at root, use `BASE_PATH=/`.

### Clerk auth errors: "Unauthorized" on every request

- Confirm `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set on the API server.
- Confirm `VITE_CLERK_PUBLISHABLE_KEY` was set at portal **build** time (not runtime).
- The publishable key in the portal bundle must match the API server.

### Emails are not being sent

- Confirm all three email variables are set: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM`.
- Verify the SES sender domain is verified.
- Check the IAM user has `ses:SendRawEmail` permission.
- In SES sandbox mode, recipient addresses must also be verified.

### Fleet deployment shows "offline" immediately after registration

- **Poll mode:** Wait one 5-minute cycle. Verify the deployment URL is reachable: `curl <url>/api/healthz`
- **Push mode:** Check `FLEET_HUB_URL` and `FLEET_API_KEY` on the client. Check client logs for heartbeat push errors.
