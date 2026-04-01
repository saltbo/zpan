# Contributing

By participating in this project, you agree to abide by our [Code of Conduct](CODEOFCONDUCT.md).

## Setup

Prerequisites: Node.js 20+, pnpm 10+

```sh
git clone git@github.com:saltbo/zpan.git
cd zpan
pnpm install
```

## Development

```sh
pnpm dev              # Start server + web dev servers
pnpm pages:dev        # Build & run as Cloudflare Pages locally
```

## Quality Gates

Every commit and PR must pass these checks. Lefthook enforces them on pre-commit.

```sh
pnpm lint             # Biome — lint + format check
pnpm typecheck        # TypeScript strict mode, all packages
pnpm test             # Unit + integration tests (Node runtime, 90% coverage gate)
pnpm test:cf          # Integration tests (Cloudflare Workers runtime)
pnpm e2e              # Playwright E2E tests
```

## Adding a Feature

1. **Write code** in the relevant package (`packages/server`, `packages/web`, `packages/shared`)
2. **Write tests** — co-locate with source as `*.test.ts` (Node) or `*.cf-test.ts` (CF Workers)
3. **Run checks** — `pnpm lint && pnpm typecheck && pnpm test && pnpm test:cf`
4. **Coverage** — new code must maintain 90%+ line coverage on `packages/server`
5. **Commit** — use [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, etc.)
6. **PR** — target the `master` branch

## Database Migrations

Schema is defined in `packages/server/src/db/schema.ts` and `auth-schema.ts`.

```sh
# After modifying schema, generate migration SQL
pnpm --filter @zpan/server exec drizzle-kit generate

# Apply locally
wrangler d1 migrations apply zpan-db --local

# Apply to production
wrangler d1 migrations apply zpan-db --remote
```

Migration files live in `migrations/` at project root. Always commit them.

## Deployment

Primary target is Cloudflare Pages. Node.js (Docker) is the backup runtime.

```sh
pnpm build:pages      # Build frontend to dist/
pnpm deploy           # Build + deploy to Cloudflare Pages
```

The wrangler config (`wrangler.toml`) uses:
- `main` → worker entry point (bundled by wrangler)
- `[assets]` → static frontend with SPA fallback
- `run_worker_first = ["/api/*"]` → only API routes hit the worker

## Project Structure

```
zpan/
├── packages/
│   ├── server/           # Hono API (routes, middleware, auth, platform abstraction)
│   ├── web/              # React frontend (TanStack Router, shadcn/ui)
│   └── shared/           # Shared types, Zod schemas, constants
├── migrations/           # D1/SQLite migrations (drizzle-kit generated, wrangler managed)
├── e2e/                  # Playwright E2E tests
├── wrangler.toml         # Cloudflare Pages + Workers config
├── biome.json            # Lint + format config
└── lefthook.yml          # Pre-commit hooks
```

## Financial Contributions

We welcome financial contributions on our [Open Collective](https://opencollective.com/zpan).

## Contributors

Thank you to all the people who have already contributed to ZPan!

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>
