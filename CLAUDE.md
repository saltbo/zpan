# CLAUDE.md

## Project Overview

ZPan v2 is an open-source, S3-native file hosting platform written in TypeScript. Cloudflare Workers is the primary deployment target, Node.js (Docker) is backup.

Core architecture: clients upload directly to S3-compatible storage via presigned URLs, bypassing server bandwidth.

## Key Context

- Single package: `server/` (Hono API), `src/` (React SPA), `shared/` (types/schemas)
- CF Workers: `workers/bootstrap.ts` (CF Workers + D1) and `server/entry-node.ts` (Node + SQLite)
- Tests are co-located: `*.test.ts` (Node), `*.cf-test.ts` (CF Workers)
- Migrations: drizzle-kit generates SQL → wrangler manages D1 state

## Docs Index

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, commands, quality gates, migration workflow, deployment
- [docs/architecture.md](docs/architecture.md) — system architecture, tech decisions, platform abstraction
- [V2_ROADMAP.md](V2_ROADMAP.md) — product positioning, release plan (v2.0–v2.9)
- [docs/roadmap/](docs/roadmap/) — per-version technical specs (v2.0.md–v2.9.md)

## CONTRIBUTING.md Compliance

All processes defined in [CONTRIBUTING.md](CONTRIBUTING.md) are mandatory. Every PR must follow them exactly — including preview verification before merge. No exceptions.

## Full-Stack Thinking

This is a full-stack project. When implementing a feature or fixing a bug, think end-to-end across frontend and backend. Don't limit yourself to only changing the frontend or only changing the backend — do what's correct for the problem. If the backend API is wrong, fix the backend. If the frontend approach is wrong, fix the frontend. If a feature needs both, change both. Always consider the full request lifecycle: URL → route → API → service → DB → response → UI.

## Commit Convention

Conventional Commits (`feat:`, `fix:`, `docs:`, etc.). PRs target `master`.

## Pre-commit Hooks

Husky runs `npm run typecheck` + lint-staged (biome auto-fix) on every `git commit`. **Never** bypass with `--no-verify`. **Never** run `npm install --ignore-scripts` — the `prepare` script must run so hooks are installed. If a hook fails, fix the underlying issue and re-commit.

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

## Migrations

**Always** generate migrations with `npm run db:generate` (drizzle-kit). **Never** hand-author the `.sql` file or the `migrations/meta/_journal.json` entry.

Why: drizzle-kit migrator orders migrations by the `when` timestamp in `_journal.json`. Hand-written entries with guessed timestamps break the ordering silently — drizzle sees the new migration's `when` as older than the last applied one and skips it, leaving dev databases out of sync while CI (which starts from empty) passes cleanly. Past incident: v2.3.0 T1/T2 shipped journal entries with `when = 1745000000000` (April 2025) while the last applied migration was `when = 1776200000000` (March 2026); every developer already at 0009 silently missed 0010/0011.

If `drizzle-kit generate` errors about TTY in CI, **fix the CI invocation** (pass `--name`, set `CI=true`, or run it outside CI) — do **not** fall back to hand-writing the journal.

## Frontend API Wrappers

**Every new function added to `src/lib/api.ts` must have a corresponding test added to `src/lib/api.test.ts` in the same PR.** Codecov rejects PRs where `src/lib/api.ts` gains uncovered lines. For each wrapper, assert: correct RPC path and method, payload shape, success path resolves, error path throws `ApiError`. Follow the pattern already established for `listShares`/`getShare`/`deleteShare`/`listNotifications`/etc.
