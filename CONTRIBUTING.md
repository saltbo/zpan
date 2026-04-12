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
npm run dev              # Start server + web dev servers (reads .dev.vars)
npm run dev:pages        # Build & run as Cloudflare Pages locally
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

Every PR that touches UI or API behavior **must** be verified in the Cloudflare Pages preview environment before merging. The verification report **must** be posted as a PR comment — a PR without a verification comment cannot be merged.

Cloudflare Pages automatically deploys each PR to a preview URL (posted as a PR comment, e.g. `https://<hash>.zpan.pages.dev`).

Before merging, the reviewer **must** verify in the preview environment and post a PR comment with:
   - **Screenshots** proving the feature works (golden path + edge cases)
   - **What was tested** (e.g. "Switched theme to dark, changed language to Chinese, verified password mismatch error")
   - **Verdict** — approve or request changes

A code-review-only approval (reading the diff without visiting the preview) is **not sufficient** to merge.

### Preview environment details

- All PRs share one preview D1 database (`zpan-db-preview`) — data persists across deployments
- A dev storage backend is pre-configured, so file upload works out of the box
- The first user to sign up on a fresh preview DB becomes admin
- If you need a clean state, coordinate with maintainers

## Database Migrations

Schema is defined in `server/db/schema.ts` and `server/db/auth-schema.ts`.

```sh
npm run db:generate                            # Generate migration SQL after schema changes
npm run db:migrate                             # Apply migrations (Node/SQLite)
wrangler d1 migrations apply zpan-db --local   # Apply migrations (CF Pages local)
wrangler d1 migrations apply zpan-db --remote  # Apply migrations (CF Pages production)
```

To reset local databases with seed data (admin user + dev storage):

```sh
npm run db:reset                # Reset Node database (zpan.db)
npm run db:reset:pages          # Reset D1 local database (.wrangler)
```

Migration files live in `migrations/` at project root. Always commit them.

## Deployment

Primary target is Cloudflare Pages. Node.js (Docker) is the backup runtime.

```sh
npm run build:pages      # Build frontend to dist/
npm run deploy           # Build + deploy to Cloudflare Pages
```

The wrangler config (`wrangler.toml`) uses:
- `main` → worker entry point (bundled by wrangler)
- `[assets]` → static frontend with SPA fallback
- `run_worker_first = ["/api/*"]` → only API routes hit the worker

## Project Structure

```
zpan/
├── server/               # Hono API (routes, middleware, auth, platform abstraction)
├── src/                  # React frontend (TanStack Router, shadcn/ui)
├── shared/               # Shared types, Zod schemas, constants
├── functions/            # CF Pages Functions entry
├── migrations/           # D1/SQLite migrations (drizzle-kit generated, wrangler managed)
├── wrangler.toml         # Cloudflare Pages + Workers config
└── biome.json            # Lint + format config
```

## Financial Contributions

We welcome financial contributions on our [Open Collective](https://opencollective.com/zpan).

## Contributors

Thank you to all the people who have already contributed to ZPan!

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>
