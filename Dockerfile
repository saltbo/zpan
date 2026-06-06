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
 && pnpm prune --prod --ignore-scripts

FROM golang:1.25 AS cli-builder
WORKDIR /app/cmd
COPY cmd/go.mod cmd/go.sum ./
RUN go mod download
COPY cmd ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/zpan ./zpan

FROM debian:bookworm-slim AS geoip-db
ARG GEOIP_DB_MONTH=2026-06
ARG GEOIP_DB_URL=https://download.db-ip.com/free/dbip-city-lite-${GEOIP_DB_MONTH}.mmdb.gz
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gzip \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /out \
 && curl -fsSL "$GEOIP_DB_URL" -o /tmp/geoip.mmdb.gz \
 && gzip -dc /tmp/geoip.mmdb.gz > /out/geoip.mmdb \
 && rm -f /tmp/geoip.mmdb.gz

FROM debian:bookworm-slim AS cli
RUN apt-get update \
 && apt-get install -y --no-install-recommends aria2 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && addgroup --system zpan \
 && adduser --system --ingroup zpan --home /home/zpan zpan \
 && mkdir -p /home/zpan/.local/share/zpan
COPY --from=cli-builder /out/zpan /usr/local/bin/zpan
COPY --from=geoip-db /out/geoip.mmdb /home/zpan/.local/share/zpan/geoip.mmdb
RUN mkdir -p /home/zpan/.config/zpan /home/zpan/.local/state/zpan/downloader /downloads \
 && chown -R zpan:zpan /home/zpan /downloads
USER zpan
ENV HOME=/home/zpan
WORKDIR /downloads
ENTRYPOINT ["zpan"]
CMD ["downloader", "up"]

FROM node:24-slim
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends aria2 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && addgroup --system zpan \
 && adduser --system --ingroup zpan --home /home/zpan zpan \
 && mkdir -p /home/zpan/.local/share/zpan

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts/docker-entrypoint.sh /app/scripts/docker-entrypoint.sh
COPY --from=cli-builder /out/zpan /usr/local/bin/zpan
COPY --from=geoip-db /out/geoip.mmdb /home/zpan/.local/share/zpan/geoip.mmdb

RUN mkdir -p /data /home/zpan/.config/zpan /home/zpan/.local/state/zpan/downloader \
 && chown -R zpan:zpan /data /home/zpan

USER zpan

ENV NODE_ENV=production
ENV HOME=/home/zpan
ENV PORT=8222
EXPOSE 8222

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist-server/entry-node.js"]
