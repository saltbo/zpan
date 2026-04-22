# Contributing

By participating in this project, you agree to abide by our [Code of Conduct](CODEOFCONDUCT.md).

## Setup

Prerequisites: Node.js 24+ (managed by [Volta](https://volta.sh/))

```sh
git clone git@github.com:saltbo/zpan.git
cd zpan
npm install
```

## Development

```sh
npm run dev              # CF Workers mode with HMR (default, uses staging D1)
npm run dev:node         # Node.js mode with HMR (SQLite, reads .dev.vars)
```

## Quality Gates

Every commit and PR must pass these checks. Husky enforces them on pre-commit.

```sh
npm run lint             # Biome — lint + format check
npm run typecheck        # TypeScript strict mode
npm test                 # Unit + integration tests (Node runtime, 90% coverage gate)
npm run test:cf          # Integration tests (Cloudflare Workers runtime)
npm run e2e              # Playwright E2E tests
```

## Adding a Feature

1. **Write code** in the relevant directory (`server/`, `src/`, `shared/`)
2. **Write tests** — co-locate with source as `*.test.ts` (Node) or `*.cf-test.ts` (CF Workers)
3. **Run checks** — `npm run lint && npm run typecheck && npm test && npm run test:cf`
4. **Coverage** — new code must maintain 90%+ line coverage on `server/`
5. **Commit** — use [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, etc.)
6. **PR** — target the `master` branch
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

### Staging test account

A shared test account is available on the staging database for preview verification:

| Field | Value |
|-------|-------|
| Email | `reviewer@zpan.dev` |
| Password | `zpan-staging-reviewer-2026` |

Use this account for UI regression testing in preview deployments. **Do not change the password** — other contributors depend on it.

For admin feature testing, read admin credentials from the local `.dev.vars` file (`DEV_ADMIN_PASSWORD`). The admin email is `admin@zpan.space`.

## Database Migrations

Schema is defined in `server/db/schema.ts` and `server/db/auth-schema.ts`.

```sh
npm run db:generate                            # Generate migration SQL after schema changes
npm run db:migrate                             # Apply migrations (Node/SQLite)
npm run db:migrate:d1                          # Apply migrations (D1 local)
wrangler d1 migrations apply zpan-db --remote  # Apply migrations (D1 production)
```

To reset local databases with seed data (admin user + dev storage):

```sh
npm run db:reset                # Reset Node database (zpan.db)
npm run db:reset:d1             # Reset D1 local database (.wrangler)
```

Migration files live in `migrations/` at project root. Always commit them.

### Turso (libSQL) migrate path

When deploying the Node/Docker image against a Turso (libSQL) database, set `TURSO_DATABASE_URL` (and `TURSO_AUTH_TOKEN` for remote URLs) before running `db:migrate`. `drizzle.config.ts` detects the env var and switches to the `turso` dialect automatically:

```sh
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=your-token \
npm run db:migrate
```

For local libSQL files the token can be omitted:

```sh
TURSO_DATABASE_URL=file:./zpan.db npm run db:migrate
```

Migrations run automatically at Docker container startup when `TURSO_DATABASE_URL` is set. See [docs/deploy/docker.md](docs/deploy/docker.md) for the full Docker + Turso setup.

## Deployment

Primary target is Cloudflare Workers. Node.js (Docker) is the backup runtime.

```sh
npm run build            # Build frontend to dist/
npm run deploy           # Build + deploy to Cloudflare Workers
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
