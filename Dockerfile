# syntax=docker/dockerfile:1.7

FROM node:20-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ packages/

RUN pnpm install --frozen-lockfile
RUN pnpm build:pages
RUN pnpm --filter @zpan/server build

FROM node:20-slim
WORKDIR /app

# Frontend assets — vite outputs to /app/dist (see packages/web/vite.config.ts)
COPY --from=builder /app/dist ./dist

# Bundled server entrypoint
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# Native modules (better-sqlite3) and other runtime deps
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /app/packages/shared ./packages/shared

RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=8222
EXPOSE 8222

# Run from packages/server/dist so the relative static root `../../dist`
# in entry-node.ts resolves to /app/packages/dist… wait, mirror dev layout:
# cwd must be two dirs deep so `../../dist` → /app/dist.
WORKDIR /app/packages/server/dist
RUN ln -s /app/dist /app/packages/dist

CMD ["node", "entry-node.js"]
