# Ekai Support

**Ekai** is a self-hostable B2B customer support platform built for software companies. It provides a web-based support portal for customers and agents, a mobile companion app, SLA tracking, a knowledge base, and a fleet health monitoring dashboard for client deployments.

## Services at a glance

| Service | Stack | Purpose |
|---|---|---|
| **API Server** | Express 5 + Drizzle ORM | REST API, background sweeps, fleet monitoring |
| **Support Portal** | React + Vite + Tailwind | Web UI for customers, agents, and admins |
| **Mobile App** | Expo / React Native | Mobile companion for agents and customers |

## Auth modes

Ekai supports two authentication modes, selected at deploy time:

| Mode | `AUTH_MODE` | Best for |
|---|---|---|
| **Local** (default) | `local` | Self-hosting — built-in email + password, no external accounts |
| **Clerk** | `clerk` | SaaS / managed hosting — delegates auth to [Clerk](https://clerk.com) |

For a new self-hosted installation, `AUTH_MODE=local` is recommended. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full setup guide.

## Quick start (Docker — self-hosted)

```bash
# 1. Copy and fill in the environment file
cp .env.example .env
# Set POSTGRES_PASSWORD and SESSION_SECRET (run: openssl rand -hex 32)
# Leave AUTH_MODE=local (the default)

# 2. Validate config
./scripts/check-env.sh

# 3. Start everything
docker compose up -d --build

# 4. Bootstrap the first admin account
#    Read the bootstrap token from the API server logs:
docker compose logs api-server | grep "bootstrapToken"

#    Then call the bootstrap endpoint:
curl -s -X POST http://localhost:8080/api/bootstrap-admin \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@yourcompany.com","bootstrapToken":"<token-from-logs>"}' \
  | jq '{email, initialPassword, loginUrl}'

# 5. Open the portal and sign in with the returned initialPassword
open http://localhost
```

## Development

```bash
# Install dependencies
pnpm install

# Start all services (each in its own terminal, or use a process manager)
pnpm --filter @workspace/api-server  run dev   # API server → PORT env var
pnpm --filter @workspace/support-portal run dev # Portal     → PORT + BASE_PATH

# Run tests
pnpm --filter @workspace/api-server run test

# Type-check everything
pnpm --filter @workspace/api-server    run typecheck
pnpm --filter @workspace/support-portal run typecheck
```

## Deploying

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete deployment instructions, including:

- [Ubuntu + Docker (recommended for self-hosting)](./DEPLOYMENT.md#ubuntu--docker-recommended)
- [Self-hosted (bare metal / VM)](./DEPLOYMENT.md#self-hosted-bare-metal--vm)
- [Docker Compose](./DEPLOYMENT.md#docker-compose)
- [Kubernetes (EKS / AKS / GKE)](./DEPLOYMENT.md#kubernetes)
- [Auth mode reference](./DEPLOYMENT.md#authentication)
- [Fleet monitoring](./DEPLOYMENT.md#fleet-monitoring)
- [Environment variables reference](./DEPLOYMENT.md#environment-variables-reference)

## License

Proprietary. All rights reserved.
