# syntax=docker/dockerfile:1.7

FROM node:24-slim AS builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable \
 && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build:node \
 && pnpm prune --prod

FROM node:24-slim
WORKDIR /app

RUN addgroup --system zpan && adduser --system --ingroup zpan zpan

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts/docker-entrypoint.sh /app/scripts/docker-entrypoint.sh

RUN mkdir -p /data && chown zpan:zpan /data

USER zpan

ENV NODE_ENV=production
ENV PORT=8222
EXPOSE 8222

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist-server/entry-node.js"]
