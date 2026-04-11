# syntax=docker/dockerfile:1.7

# -- Stage 1: install all deps (for build) --
FROM node:24-slim AS deps
WORKDIR /app
COPY package-lock.json package.json ./
RUN npm ci

# -- Stage 2: build frontend + server bundle --
FROM deps AS builder
COPY . .
RUN npm run build && npm run build:server

# -- Stage 3: install prod-only deps (for runtime) --
FROM node:24-slim AS deps-prod
WORKDIR /app
COPY package-lock.json package.json ./
RUN npm ci --omit=dev

# -- Stage 4: runtime --
FROM node:24-slim
WORKDIR /app

RUN addgroup --system zpan && adduser --system --ingroup zpan zpan

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/migrations ./migrations

RUN mkdir -p /data && chown zpan:zpan /data

USER zpan

ENV NODE_ENV=production
ENV PORT=8222
EXPOSE 8222

CMD ["node", "dist-server/entry-node.js"]
