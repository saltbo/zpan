# CLAUDE.md

## Project Overview

ZPan v2 is an open-source, S3-native file hosting platform written in TypeScript. Cloudflare Pages is the primary deployment target, Node.js (Docker) is backup.

Core architecture: clients upload directly to S3-compatible storage via presigned URLs, bypassing server bandwidth.

## Key Context

- Monorepo: `packages/server` (Hono API), `packages/web` (React SPA), `packages/shared` (types/schemas)
- Dual runtime: `entry-cloudflare.ts` (CF Workers + D1) and `entry-node.ts` (Node + SQLite)
- Tests are co-located: `*.test.ts` (Node), `*.cf-test.ts` (CF Workers)
- Migrations: drizzle-kit generates SQL → wrangler manages D1 state

## Docs Index

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, commands, quality gates, migration workflow, deployment
- [docs/architecture.md](docs/architecture.md) — system architecture, tech decisions, platform abstraction
- [V2_ROADMAP.md](V2_ROADMAP.md) — product positioning, release plan (v2.0–v2.9)
- [docs/roadmap/](docs/roadmap/) — per-version technical specs (v2.0.md–v2.9.md)
## Commit Convention

Conventional Commits (`feat:`, `fix:`, `docs:`, etc.). PRs target `master`.
