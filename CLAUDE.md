# CLAUDE.md

## Project Overview

ZPan v2 is an open-source, S3-native file hosting platform written in TypeScript. Cloudflare Pages is the primary deployment target, Node.js (Docker) is backup.

Core architecture: clients upload directly to S3-compatible storage via presigned URLs, bypassing server bandwidth.

## Key Context

- Single package: `server/` (Hono API), `src/` (React SPA), `shared/` (types/schemas)
- CF Pages Functions: `functions/api/[[route]].ts` (CF Pages + D1) and `server/entry-node.ts` (Node + SQLite)
- Tests are co-located: `*.test.ts` (Node), `*.cf-test.ts` (CF Workers)
- Migrations: drizzle-kit generates SQL → wrangler manages D1 state

## Docs Index

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, commands, quality gates, migration workflow, deployment
- [docs/architecture.md](docs/architecture.md) — system architecture, tech decisions, platform abstraction
- [V2_ROADMAP.md](V2_ROADMAP.md) — product positioning, release plan (v2.0–v2.9)
- [docs/roadmap/](docs/roadmap/) — per-version technical specs (v2.0.md–v2.9.md)
## Commit Convention

Conventional Commits (`feat:`, `fix:`, `docs:`, etc.). PRs target `master`.

## Pre-commit Hooks

Husky runs `pnpm typecheck` + lint-staged (biome auto-fix) on every `git commit`. **Never** bypass with `--no-verify`. **Never** run `pnpm install --ignore-scripts` — the `prepare` script must run so hooks are installed. If a hook fails, fix the underlying issue and re-commit.

## API Client (Hono RPC)

The frontend **must** use Hono RPC client for all API calls. **Never** use raw `fetch()` with hardcoded URL strings.

```typescript
// ✅ Correct — type-safe, compile-time path validation
import { hc } from 'hono/client'
import type { AppType } from '@server/app'
const client = hc<AppType>('/')
const res = await client.api.admin.storages.$get()

// ❌ Wrong — hardcoded path, no type safety
const res = await fetch('/api/admin/storages')
```

Exception: `uploadToS3()` calls external S3 presigned URLs, not our API — raw `fetch` is OK there.

## Types

All shared types live in `shared/`. **Never** create duplicate type definitions in `src/` or `server/`. Import from `@shared/types` and `@shared/constants`.
