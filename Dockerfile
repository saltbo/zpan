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

FROM golang:1.25 AS downloader-builder
WORKDIR /app/downloader
COPY downloader/go.mod downloader/go.sum ./
RUN go mod download
COPY downloader ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/zpan-downloader ./cmd/zpan-downloader

FROM node:24-slim
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends aria2 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && addgroup --system zpan \
 && adduser --system --ingroup zpan --home /home/zpan zpan

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts/docker-entrypoint.sh /app/scripts/docker-entrypoint.sh
COPY --from=downloader-builder /out/zpan-downloader /usr/local/bin/zpan-downloader

RUN mkdir -p /data /home/zpan/.config/zpan-downloader /home/zpan/.local/state/zpan-downloader \
 && chown -R zpan:zpan /data /home/zpan

USER zpan

ENV NODE_ENV=production
ENV HOME=/home/zpan
ENV PORT=8222
EXPOSE 8222

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist-server/entry-node.js"]
