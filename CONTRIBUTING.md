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
npm run dev              # Start server + web dev servers
npm run pages:dev        # Build & run as Cloudflare Pages locally
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

## Database Migrations

Schema is defined in `server/db/schema.ts` and `server/db/auth-schema.ts`.

```sh
# After modifying schema, generate migration SQL
npx drizzle-kit generate

# Apply locally
wrangler d1 migrations apply zpan-db --local

# Apply to production
wrangler d1 migrations apply zpan-db --remote
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
