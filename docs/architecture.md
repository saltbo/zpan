# Architecture & Technical Decisions

Technical reference for the current ZPan implementation. Product sequencing and
future scope live in [V2_ROADMAP.md](../V2_ROADMAP.md) and
[`docs/roadmap/`](roadmap/), not in this document.

## System Shape

ZPan is a single-package full-stack TypeScript application. The server is the
control plane for auth, metadata, quotas, sharing, WebDAV, background jobs, and
paid-tier entitlement checks. File bytes live in S3-compatible object storage and
are uploaded or downloaded through presigned URLs whenever possible.

```text
Browser SPA / WebDAV / API clients / downloader agents
                    |
                    v
             Hono application
                    |
        middleware + route modules
                    |
                    v
                 usecases
                    |
             ports / Deps object
                    |
   +----------------+----------------+
   |                |                |
 repos          gateways         providers
   |                |                |
Drizzle DB    S3 / Cloud / mail   CF APIs / changelog
```

Primary deployment target is Cloudflare Workers. Node.js/Docker is the backup
runtime, and the same Hono app is adapted for other serverless targets.

## Core Decisions

| Area | Decision | Reason |
|------|----------|--------|
| Server framework | Hono | Runs cleanly on Workers and Node with web-standard Request/Response |
| API typing | Hono RPC for frontend, OpenAPI for external clients | Frontend gets compile-time path/type safety; non-TS clients get a stable REST contract |
| Runtime database | D1 on Workers, SQLite or Turso/libSQL elsewhere | One SQLite-family schema across every deployment target |
| ORM | Drizzle | Type-safe SQLite/D1 schema and migrations with low runtime overhead |
| Auth | Better Auth | Email/password, social/OIDC, organizations, API keys, device flow |
| Object storage | S3-compatible protocol | Works with R2, S3, MinIO, B2, Tigris, RustFS, and similar providers |
| Frontend | React 19 + Vite + TanStack Router | SPA with typed file routes and no server-rendering framework lock-in |
| UI | shadcn/ui-style components, Radix UI, Tailwind CSS 4, Lucide | Local component ownership with consistent interaction primitives |
| Tests | Vitest projects + Playwright | Unit, integration, Workers runtime, libSQL, and browser-level coverage |

## Repository Layout

```text
zpan/
├── server/
│   ├── adapters/       # Concrete repos, gateways, and providers
│   ├── db/             # Drizzle schemas and DB helpers
│   ├── domain/         # Pure domain helpers and policy logic
│   ├── http/           # Hono route modules
│   ├── middleware/     # Hono middleware and principal resolution
│   ├── platform/       # Runtime adapters: Workers, Node, libSQL
│   ├── usecases/       # Business workflows and port interfaces
│   ├── app.ts          # Hono app composition and route mounting
│   ├── auth.ts         # Better Auth configuration
│   ├── bootstrap.ts    # Runtime-independent app bootstrap
│   └── entry-*.ts      # Node/serverless entry points
├── src/
│   ├── components/     # UI components and feature views
│   ├── hooks/          # Frontend hooks
│   ├── i18n/           # Frontend translations
│   ├── lib/            # RPC clients, API wrappers, formatters, utilities
│   └── routes/         # TanStack Router file routes
├── shared/             # Shared schemas, constants, feature registry, types
├── workers/            # Cloudflare Worker fetch/scheduled/queue entry
├── migrations/         # drizzle-kit generated SQL migrations
├── e2e/                # Playwright tests
├── wrangler.toml       # Cloudflare Workers configuration
└── package.json        # Single pnpm package
```

There is no native desktop or mobile client workspace in this repository.
Native client implementations are expected to live in separate projects. This
repository can still own server-side API contracts and isolated automation
clients when they are part of the ZPan server/web product boundary.

## Runtime Entry Points

### Cloudflare Workers

[`workers/bootstrap.ts`](../workers/bootstrap.ts) exports the Worker handlers:

- `fetch` creates a Cloudflare platform from the request environment, reuses a
  cached Better Auth instance per isolate, injects Open Graph tags for share
  pages, then delegates to `createApp`.
- `scheduled` delegates to [`workers/scheduled.ts`](../workers/scheduled.ts) for
  licensing refresh, traffic sync, quota reset, trash purge, and telemetry.
- `queue` runs archive-job messages through the archive jobs gateway.

### Node / Docker / Cloud Run

[`server/entry-node.ts`](../server/entry-node.ts) serves the same Hono app plus
the built SPA from `dist/`. It chooses the platform at boot:

- `TURSO_DATABASE_URL` set: libSQL/Turso via `createLibsqlPlatform`
- otherwise: local SQLite via `createNodePlatform`

Because Node has no platform scheduler, the entry starts interval-based jobs for
license refresh, traffic sync, quota reset, trash purge, and telemetry.

### Other Serverless Targets

`server/entry-lambda.ts`, `server/entry-vercel.ts`,
`server/entry-netlify.ts`, and `server/entry-azure.ts` are thin adapters around
the same app and platform model. Business logic does not fork by deployment
target.

## Platform Abstraction

[`server/platform/interface.ts`](../server/platform/interface.ts) is the runtime
boundary:

```ts
interface Platform {
  db: Database
  getEnv(key: string): string | undefined
  getBinding<T = unknown>(key: string): T | undefined
}
```

Concrete implementations:

- `cloudflare.ts` wraps D1 and platform bindings.
- `node.ts` wraps `better-sqlite3`.
- `libsql.ts` wraps `@libsql/client` and runs migrations against Turso/libSQL.
- `context.ts` provides an `AsyncLocalStorage` proxy so shared objects can read
  the active request platform safely.

Only runtime infrastructure belongs in `platform/`. Business decisions stay in
usecases and domain modules.

## Server Layering

The server follows a ports-and-adapters shape.

### `server/app.ts`

Creates the Hono app, installs global middleware, exposes OpenAPI/Scalar docs,
mounts WebDAV, and mounts each API resource. It also merges Better Auth's
generated OpenAPI schema into `/api/openapi.json`.

### `server/http/`

Route modules own HTTP concerns:

- path shape and Hono mounting
- request validation and response serialization
- route-level auth guards
- OpenAPI route metadata

Routes should call usecases or narrow domain helpers. They should not reimplement
business workflows.

### `server/usecases/`

Usecases own business workflows and coordination:

- file object create/upload/complete/trash/restore/transfer
- quota checks and traffic metering
- sharing and save-to-drive behavior
- team and user administration
- site settings, licensing, announcements, branding, audit
- archive processing and remote download task orchestration

Usecases receive `deps` as their first argument and reach the outside world only
through ports.

### `server/usecases/ports*.ts`

Ports define the contracts usecases need from persistence and external systems:
repos, S3, email, zip, Cloud licensing, image upload, download tokens, and
similar dependencies.

### `server/adapters/`

Adapters implement ports:

- `repos/` persists to Drizzle tables.
- `gateways/` talks to S3, email, ZPan Cloud, archive queues, and zip handling.
- `providers/` wraps platform/provider-specific APIs such as Cloudflare custom
  hostnames or changelog fetching.

[`server/composition.ts`](../server/composition.ts) is the composition root and
the only place concrete adapters are assembled into the `Deps` object.

### `server/domain/`

Pure policy and transformation helpers live here when they do not need I/O:
licensing checks, path templating, WebDAV XML helpers, share rules, quota math,
name-conflict planning, and similar logic.

## Authentication And Principals

Better Auth owns the core auth tables and session lifecycle. ZPan adds route
guards and principal normalization in [`server/middleware/auth.ts`](../server/middleware/auth.ts).

The auth middleware is intentionally soft-fail: it tries to identify the caller
and sets context variables, while each route decides whether anonymous access is
allowed.

Supported principals:

- `user` — browser cookie session or bearer session
- `api-key` — Better Auth API key plugin, including org-scoped keys
- `downloader` — remote downloader agent token
- `download-task-upload` — scoped token that lets a downloader upload one task's
  completed output

Route guards then enforce `requireAuth`, `requireAdmin`, `requireDownloader`, or
`requireTeamRole('viewer' | 'editor' | 'owner')`.

## Data Model

Drizzle schemas live in [`server/db/schema.ts`](../server/db/schema.ts) and
[`server/db/auth-schema.ts`](../server/db/auth-schema.ts). Migrations live at the
repo root in `migrations/` and are generated with `pnpm db:generate`.

Major table groups:

- **Auth and organizations**: `user`, `session`, `account`, `organization`,
  `member`, `invitation`, `apikey`, `deviceCode`
- **Objects and storage**: `matters`, `storages`, `object_upload_sessions`
- **Quota and billing**: `org_quotas`, `org_quota_entitlements`,
  `cloud_traffic_reports`, `webhook_events`
- **Sharing and notifications**: `shares`, `share_recipients`, `notifications`
- **Site administration**: `system_options`, `license_bindings`,
  `announcements`, `activity_events`, invite tables
- **WebDAV**: `webdav_dead_properties`, `webdav_locks`
- **Jobs and downloaders**: `background_jobs`, `downloaders`, `download_tasks`,
  `remote_download_usage_reports`
- **Image hosting**: `image_hosting_configs`, `image_hostings`

`matters` is the file tree. Every object belongs to an organization (`orgId`),
not directly to a user. Storage object keys are implementation details hidden
behind ZPan's object and storage abstractions.

## File And Object Flow

### Browser Upload

1. Frontend calls `POST /api/objects` through the Hono RPC wrapper.
2. Server creates a draft `matters` row plus an `object_upload_sessions` row.
3. Server returns presigned upload instructions.
4. Browser uploads bytes directly to S3/R2 with raw `fetch` to the presigned URL.
5. Frontend calls the completion endpoint.
6. Server verifies and activates the `matters` row, updates quota/usage, and
   records activity.

Abort paths discard the draft and try to clean up storage-side multipart state
where possible.

### Download

Authenticated object downloads and public share downloads resolve metadata in
ZPan, enforce access/quota/credit rules, and return or redirect to a presigned
object-storage URL. ZPan does not proxy file bytes unless a feature explicitly
requires it.

### Remote Download

1. A user creates a `download_tasks` row.
2. A registered downloader agent heartbeats to `/api/downloads/downloaders`.
3. The server assigns queued tasks based on availability/capabilities.
4. The downloader fetches source bytes outside the main ZPan runtime.
5. The downloader uploads completed output back through a scoped task-upload
   token and the normal object upload path.
6. ZPan records status, activity, and optional remote-download usage reports.

### WebDAV

WebDAV paths resolve to `matters` records through the WebDAV usecases and repos.
Object keys remain private implementation details. Browser UI, API, and WebDAV
all share the same authorization and storage model.

### Archive Jobs

Archive operations use `background_jobs` for durable status and progress. On
Workers, queue messages execute archive work. On Node, archive work runs through
the gateway path available to the current runtime.

## Frontend Architecture

The frontend is a Vite React SPA.

- File routes live in `src/routes/` via TanStack Router.
- Data fetching uses TanStack Query.
- API wrappers live in `src/lib/api.ts`; each wrapper is tested in
  `src/lib/api.test.ts`.
- RPC clients live in `src/lib/rpc.ts` and use Hono RPC types exported from
  `server/app.ts`.
- Shared types and schemas must come from `shared/`.
- UI components live under `src/components/`, grouped by feature and common UI
  primitives.
- i18n strings live in `src/i18n/locales/en.json` and `zh.json`.

Frontend code must call ZPan APIs through Hono RPC wrappers. The exception is
external URLs that are not ZPan APIs, such as presigned S3 upload URLs.

## API Surfaces

- `/api/*` — primary JSON API, mounted from route modules in `server/http/`
- `/api/auth/*` — Better Auth routes
- `/api/openapi.json` — combined OpenAPI document for ZPan routes and Better
  Auth routes
- `/api/docs` — Scalar API reference
- `/dav/*` — WebDAV endpoint
- `/api/events` — server-sent events for notifications, jobs, and download-task
  updates
- `/r/*` and `/s/*` — public redirect/share surfaces
- `/api/store/*` — quota store and Cloud webhook endpoints

Public, authenticated, admin, downloader, and webhook routes can share a path
prefix. Authorization is per route or per mounted sub-app, so mount order matters
when a public/user router and admin router share a prefix.

## Background Work

Cloudflare Workers:

- `scheduled()` handles license refresh, traffic report sync, quota reset, trash
  purge, and telemetry.
- `queue()` handles archive job messages.

Node/Docker:

- `server/entry-node.ts` runs equivalent recurring work with `setInterval`.

Background jobs must be idempotent where possible. External delivery and Cloud
reporting tables use stable event ids to prevent duplicate effects.

## Paid-Tier Architecture

Paid-tier availability is certificate based.

- ZPan Cloud is the source of truth for subscriptions and bound instances.
- ZPan stores the active binding in `license_bindings`.
- ZPan verifies signed entitlement certificates locally.
- `shared/feature-registry.ts` is the feature-comparison and gate-key source of
  truth.
- `server/middleware/require-feature.ts` gates API routes that require a paid
  feature.

The quota store uses Cloud for checkout/payment and ZPan for local catalog,
entitlement delivery, quota calculation, and usage enforcement.

## Testing And Quality Gates

Configured test projects in [`vitest.config.ts`](../vitest.config.ts):

- `unit` — pure utilities, schemas, domain helpers, and frontend components in
  jsdom
- `integration` — Hono route/usecase integration against SQLite
- `cloudflare` — Workers runtime tests with D1 migrations applied through
  `@cloudflare/vitest-pool-workers`
- `libsql` — platform smoke tests for the libSQL/Turso path

Other gates:

- `pnpm lint` — Biome lint and format check
- `pnpm typecheck` — server and frontend TypeScript projects
- `pnpm test` — unit + integration
- `pnpm test:cf` — Workers runtime tests
- `pnpm test:libsql` — libSQL platform tests
- `pnpm e2e` — Playwright browser flows

Every PR that changes API or UI behavior also needs preview-environment
verification per [CONTRIBUTING.md](../CONTRIBUTING.md).

## Architectural Rules

- Keep the server S3-native: no provider-specific storage SDKs unless the
  abstraction genuinely requires it.
- Keep platform-specific code in `server/platform/`, Worker entry files, or
  deployment adapters.
- Keep business workflows in usecases; HTTP routes should stay thin.
- Use ports/adapters for persistence and external services.
- Put shared contracts in `shared/`; do not duplicate types in frontend/server
  folders.
- Generate migrations with drizzle-kit; do not hand-author migration journal
  entries.
- Preserve direct-to-object-storage upload/download paths unless a feature has a
  concrete reason to proxy bytes.
- Treat personal spaces and team spaces as organization-owned data containers;
  quota, sharing, WebDAV, and future clients must preserve that ownership model.
