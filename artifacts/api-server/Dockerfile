# =============================================================================
# Ekai API Server — multi-stage Docker build
# =============================================================================
# Stage 1: build
#   Installs all workspace dependencies (pnpm workspaces), compiles TypeScript
#   shared libraries, then bundles the API server with esbuild into dist/.
#
# Stage 2: run
#   Copies only the bundled output and runtime node_modules into a slim image.
# =============================================================================

ARG NODE_VERSION=24

# ---------------------------------------------------------------------------
# Stage: migrator
# ---------------------------------------------------------------------------
# A lightweight image used only to run `drizzle-kit push --force` against the
# database. It is a separate Docker build target so the runtime image (below)
# stays lean — drizzle-kit and the raw schema sources are never copied into it.
#
# Build:
#   docker build --target migrator -t ekai-migrate .
#
# Run (DATABASE_URL must be provided at runtime):
#   docker run --rm -e DATABASE_URL=postgres://... ekai-migrate
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS migrator

WORKDIR /workspace

RUN corepack enable

# Only the packages needed for schema push
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY lib/db/package.json lib/db/

# Install with devDependencies so drizzle-kit is available
RUN pnpm install --frozen-lockfile --filter @workspace/db

# Schema source files and drizzle config
COPY lib/db/ lib/db/

# DATABASE_URL must be injected at runtime (docker run -e or Compose environment:)
ENV NODE_ENV=production

# push-force is non-interactive (--force skips the confirmation prompt)
ENTRYPOINT ["pnpm", "--filter", "@workspace/db", "run", "push-force"]

# ---------------------------------------------------------------------------
# Stage 1 — builder
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS builder

WORKDIR /workspace

# Enable corepack so we get the right pnpm version without a global install
RUN corepack enable

# Copy workspace manifests first for layer-cache efficiency
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json                    lib/db/
COPY lib/api-spec/package.json              lib/api-spec/
COPY lib/api-client-react/package.json      lib/api-client-react/
COPY lib/api-zod/package.json               lib/api-zod/
COPY artifacts/api-server/package.json      artifacts/api-server/

# Install all dependencies (dev + prod) — needed for esbuild bundling
RUN pnpm install --frozen-lockfile

# Copy source
COPY lib/                                   lib/
COPY artifacts/api-server/                  artifacts/api-server/

# Build shared libraries that the API server depends on
RUN pnpm --filter @workspace/db        run build 2>/dev/null || true
RUN pnpm --filter @workspace/api-zod   run build 2>/dev/null || true

# Bundle the API server (esbuild → dist/index.mjs)
RUN pnpm --filter @workspace/api-server run build

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime

# Install only what the runtime needs (pg-native deps, etc. are handled by
# the bundle; we only need node itself plus externalized @aws-sdk / @google-cloud
# packages that esbuild cannot tree-shake).
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Externalized packages that are not bundled — install only prod deps
# All workspace package.json files must be present so pnpm can resolve the
# dependency graph and correctly symlink externalized packages (e.g. @aws-sdk/*).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json                lib/db/
COPY lib/api-spec/package.json          lib/api-spec/
COPY lib/api-zod/package.json           lib/api-zod/
COPY lib/api-client-react/package.json  lib/api-client-react/
COPY artifacts/api-server/package.json  artifacts/api-server/
RUN corepack enable && \
    pnpm install --prod --frozen-lockfile --filter @workspace/api-server

# Copy the compiled bundle from the builder into the same subtree as
# node_modules so Node.js module resolution finds packages installed by pnpm.
COPY --from=builder /workspace/artifacts/api-server/dist ./artifacts/api-server/dist

# Non-root user for security
RUN addgroup --system ekai && adduser --system --ingroup ekai ekai
USER ekai

# Health check — requires the PORT env var to be set
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/healthz').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# PORT is required at runtime; set by the orchestrator (Compose / K8s)
ENV NODE_ENV=production

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
