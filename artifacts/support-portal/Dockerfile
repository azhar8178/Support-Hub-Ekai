# =============================================================================
# Ekai Support Portal — multi-stage Docker build
# =============================================================================
# Stage 1: build
#   Runs `vite build` to produce a static SPA in dist/public/.
#
# Stage 2: serve
#   Copies the static assets into an nginx image. nginx also handles
#   the SPA fallback (all paths → index.html) and can proxy /api requests
#   to the API server when used with Docker Compose.
# =============================================================================

ARG NODE_VERSION=24

# ---------------------------------------------------------------------------
# Stage 1 — builder
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS builder

WORKDIR /workspace

RUN corepack enable

# Workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/api-client-react/package.json  lib/api-client-react/
COPY lib/api-spec/package.json          lib/api-spec/
COPY artifacts/support-portal/package.json artifacts/support-portal/

RUN pnpm install --frozen-lockfile

# Source
COPY lib/api-client-react/  lib/api-client-react/
COPY lib/api-spec/           lib/api-spec/
COPY artifacts/support-portal/ artifacts/support-portal/

# Build the generated API client (produces lib/api-client-react/dist)
RUN pnpm --filter @workspace/api-client-react run build 2>/dev/null || true

# Build the portal.
# BASE_PATH defaults to / for a standalone Docker deployment.
# Override at build time with: --build-arg BASE_PATH=/your/prefix
ARG BASE_PATH=/
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV BASE_PATH=${BASE_PATH}
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
# PORT is required by vite.config.ts even during build; use a throwaway value
ENV PORT=3001
RUN pnpm --filter @workspace/support-portal run build

# ---------------------------------------------------------------------------
# Stage 2 — nginx static server
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Remove default nginx site
RUN rm /etc/nginx/conf.d/default.conf

# nginx config is injected at build time via COPY below.
# If you need to proxy /api to the API server, mount a custom nginx.conf.
COPY artifacts/support-portal/nginx.conf /etc/nginx/conf.d/portal.conf

# Static assets from the builder
COPY --from=builder /workspace/artifacts/support-portal/dist/public /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
