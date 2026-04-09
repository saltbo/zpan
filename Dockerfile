# syntax=docker/dockerfile:1.7

# ── Stage 1: install deps (cached until lockfile changes) ──────
FROM node:20-slim AS deps
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

# ── Stage 2: build ─────────────────────────────────────────────
FROM deps AS builder

COPY packages/ packages/

RUN pnpm build:pages
RUN pnpm --filter @zpan/server build

# Extract production-only deps into a flat directory.
# pnpm deploy bundles workspace packages (e.g. @zpan/shared) into node_modules.
RUN pnpm --filter @zpan/server deploy --prod /app/pruned

# ── Stage 3: runtime ───────────────────────────────────────────
FROM node:20-slim

RUN addgroup --system zpan && adduser --system --ingroup zpan zpan

WORKDIR /app

# Frontend assets (vite outputs to repo-root/dist, see packages/web/vite.config.ts).
# Placed at /app/packages/dist so the server's `serveStatic({ root: '../../dist' })`
# resolves correctly when cwd is /app/packages/server/dist.
COPY --from=builder /app/dist ./packages/dist

# Bundled server entrypoint
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# Production node_modules (native deps like better-sqlite3 + workspace deps).
# Node resolves /app/packages/server/node_modules from cwd /app/packages/server/dist.
COPY --from=builder /app/pruned/node_modules ./packages/server/node_modules

RUN mkdir -p /data && chown zpan:zpan /data

USER zpan

ENV NODE_ENV=production
ENV PORT=8222
EXPOSE 8222

WORKDIR /app/packages/server/dist
CMD ["node", "entry-node.js"]
