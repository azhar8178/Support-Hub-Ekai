# Ekai Support

**Ekai** is a self-hostable B2B customer support platform built for software companies. It provides a web-based support portal for customers and agents, a mobile companion app, SLA tracking, a knowledge base, and a fleet health monitoring dashboard for client deployments.

## Services at a glance

| Service | Stack | Purpose |
|---|---|---|
| **API Server** | Express 5 + Drizzle ORM | REST API, background sweeps, fleet monitoring |
| **Support Portal** | React + Vite + Tailwind | Web UI for customers, agents, and admins |
| **Mobile App** | Expo / React Native | Mobile companion for agents and customers |

## Deploying

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete deployment instructions, including:

- [Self-hosted (bare metal / VM)](./DEPLOYMENT.md#self-hosted-bare-metal--vm)
- [Docker Compose](./DEPLOYMENT.md#docker-compose)
- [Kubernetes (EKS / AKS / GKE)](./DEPLOYMENT.md#kubernetes)
- [Fleet monitoring](./DEPLOYMENT.md#fleet-monitoring)
- [Environment variables reference](./DEPLOYMENT.md#environment-variables-reference)

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
pnpm --filter @workspace/api-server   run typecheck
pnpm --filter @workspace/support-portal run typecheck
```

## License

Proprietary. All rights reserved.
