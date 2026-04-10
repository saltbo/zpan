# syntax=docker/dockerfile:1.7

# -- Stage 1: install deps (cached until lockfile changes) --
FROM node:20-slim AS deps
WORKDIR /app

COPY package-lock.json package.json ./
RUN npm ci

# -- Stage 2: build --
FROM deps AS builder
COPY . .

RUN npm run build
RUN npm run build:server

# -- Stage 3: runtime --
FROM node:20-slim

RUN addgroup --system zpan && adduser --system --ingroup zpan zpan

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /data && chown zpan:zpan /data

USER zpan

ENV NODE_ENV=production
ENV PORT=8222
EXPOSE 8222

CMD ["node", "dist-server/entry-node.js"]
