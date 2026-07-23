# Contributing

By participating in this project, you agree to abide by our [Code of Conduct](CODEOFCONDUCT.md).

## Setup

Prerequisites: Node.js 24+ (managed by [Volta](https://volta.sh/))

```sh
git clone git@github.com:saltbo/zpan.git
cd zpan
pnpm install
```

## Development

```sh
pnpm dev              # CF Workers mode with HMR (default, uses staging D1)
pnpm dev:node         # Node.js mode with HMR (SQLite, reads .dev.vars)
```

## Quality Gates

Every commit and PR must pass these checks. Husky enforces them on pre-commit.

```sh
pnpm lint             # Biome — lint + format check
pnpm typecheck        # TypeScript strict mode
pnpm test                 # Unit + integration tests (Node runtime, 90% coverage gate)
pnpm test:cf          # Integration tests (Cloudflare Workers runtime)
pnpm e2e              # Playwright E2E tests
```

### Live Cloud E2E account

The Node and Cloudflare Workers E2E jobs use runtime-specific secret names, but both credential pairs may
belong to the same staging account and one-instance subscription. Both jobs therefore hold the repository-wide
`zpan-cloud-staging-e2e` concurrency lock for their full lifetime and queue instead of canceling one another.
Any new CI job that pairs against that subscription must use the same concurrency group. A job may run outside
the group only when its credentials belong to an independently licensed staging account.

The Cloud specs unbind after each serial suite, including test failures. Pairing also removes a stale test
license before retrying, so cleanup is repeatable after an interrupted run. Do not skip either cleanup path or
increase the subscription limit to make parallel jobs pass.

## Adding a Feature

1. **Write code** in the relevant directory (`server/`, `src/`, `shared/`)
2. **Write tests** — co-locate with source as `*.test.ts` (Node) or `*.cf-test.ts` (CF Workers)
3. **Run checks** — `pnpm lint && pnpm typecheck && pnpm test && pnpm test:cf`
4. **Coverage** — new code must maintain 90%+ line coverage on `server/`
5. **Commit** — use [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, etc.)
6. **PR** — target the `main` branch
7. **Preview verification** — every PR must be verified in the preview environment (see below)

## Preview Verification

Every PR that touches UI or API behavior **must** be verified in the Cloudflare Workers preview environment before merging. The verification report **must** be posted as a PR comment — a PR without a verification comment cannot be merged.

Cloudflare Workers automatically deploys each PR to a preview URL (posted as a PR comment).

Before merging, the reviewer **must** verify in the preview environment and post a PR comment with:
   - **Screenshots** proving the feature works (golden path + edge cases)
   - **What was tested** (e.g. "Switched theme to dark, changed language to Chinese, verified password mismatch error")
   - **Verdict** — approve or request changes

A code-review-only approval (reading the diff without visiting the preview) is **not sufficient** to merge.

### Preview environment details

- All PRs share one staging D1 database (`zpan-db-staging`) — data persists across deployments
- A dev storage backend is pre-configured, so file upload works out of the box
- If you need a clean state, coordinate with maintainers

### Staging test accounts

A shared test account is available on the staging database for preview verification:

| Field | Value |
|-------|-------|
| Email | `reviewer@zpan.dev` |
| Password | `zpan-staging-reviewer-2026` |

Use this account for UI regression testing in preview deployments. **Do not change the password** — other contributors depend on it.

For admin feature testing, use the dedicated non-production preview admin account:

| Field | Value |
|-------|-------|
| Email | `admin@zpan.space` |
| Password | Private maintainer `DEV_ADMIN_PASSWORD` value |

Use this account only in the staging/preview environment. **Do not commit, post, or use the password for production.**

If the staging admin account is missing, demoted, or the password stops working, a maintainer can repair it without touching production:

```sh
pnpm seed:preview-admin
```

The command reads `DEV_ADMIN_PASSWORD` from the shell environment or the gitignored local `.dev.vars` file, then targets
`zpan-db-staging` with `--env staging --remote` and upserts only `admin@zpan.space`.
To rotate the shared preview password intentionally, run the same command with the new non-production
`DEV_ADMIN_PASSWORD` value and update the private maintainer credential source in the same change.

## Database Migrations

Schema is defined in `server/db/schema.ts` and `server/db/auth-schema.ts`.

```sh
pnpm db:generate                            # Generate migration SQL after schema changes
pnpm db:migrate                             # Apply migrations (Node/SQLite)
pnpm db:migrate:d1                          # Apply migrations (D1 local)
wrangler d1 migrations apply zpan-db --remote  # Apply migrations (D1 production)
```

To reset local databases with seed data (admin user + dev storage):

```sh
pnpm db:reset                # Reset Node database (zpan.db)
pnpm db:reset:d1             # Reset D1 local database (.wrangler)
```

Migration files live in `migrations/` at project root. Always commit them.

### Storage usage backfill

After applying the migration that creates `storage_usage_breakdowns`, run the storage usage backfill once. The command is a dry run unless `--apply` is present.

```sh
pnpm storage:backfill -- --d1 zpan-db --remote
pnpm storage:backfill -- --d1 zpan-db --remote --apply

pnpm storage:backfill -- --sqlite zpan.db
pnpm storage:backfill -- --sqlite zpan.db --apply
```

The backfill recalculates all eight storage categories from `matters` and `image_hostings`. It is an operator command, not part of the application runtime or deployment lifecycle.

### Storage enabled/status backfill

After applying migrations 0066 through 0069, convert legacy storage status values into
the `enabled` flag and the `unknown`/`healthy`/`unhealthy` health model:

```sh
pnpm storage-status:backfill -- --d1 zpan-db --remote
pnpm storage-status:backfill -- --d1 zpan-db --remote --apply

pnpm storage-status:backfill -- --sqlite zpan.db
pnpm storage-status:backfill -- --sqlite zpan.db --apply
```

Run this once before deploying the application version that reads health status.

### Turso (libSQL) migrate path

When deploying the Node/Docker image against a Turso (libSQL) database, set `TURSO_DATABASE_URL` (and `TURSO_AUTH_TOKEN` for remote URLs) before running `db:migrate`. `drizzle.config.ts` detects the env var and switches to the `turso` dialect automatically:

```sh
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=your-token \
pnpm db:migrate
```

For local libSQL files the token can be omitted:

```sh
TURSO_DATABASE_URL=file:./zpan.db pnpm db:migrate
```

Migrations run automatically at Docker container startup when `TURSO_DATABASE_URL` is set. See [docs/deploy/docker.md](docs/deploy/docker.md) for the full Docker + Turso setup.

## Deployment

Primary target is Cloudflare Workers. Node.js (Docker) is the backup runtime.

```sh
pnpm build            # Build frontend to dist/
pnpm deploy           # Build + deploy to Cloudflare Workers
```

## Project Structure

```
zpan/
├── server/               # Hono API (routes, middleware, auth, platform abstraction)
├── src/                  # React frontend (TanStack Router, shadcn/ui)
├── shared/               # Shared types, Zod schemas, constants
├── workers/              # Cloudflare Workers entry
├── migrations/           # D1/SQLite migrations (drizzle-kit generated, wrangler managed)
├── wrangler.toml         # Cloudflare Workers config
└── biome.json            # Lint + format config
```

## Financial Contributions

We welcome financial contributions on our [Open Collective](https://opencollective.com/zpan).

## Contributors

Thank you to all the people who have already contributed to ZPan!

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>
