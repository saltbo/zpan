# Architecture & Technical Decisions

Technical reference for ZPan v2 development. For product roadmap, see [V2_ROADMAP.md](../V2_ROADMAP.md).

## Global Architecture

```
CF Pages (wrangler)                   Docker (Node.js)
┌─────────────────────┐
│ [assets] → web/dist  │
│ run_worker_first =   │               entry-node.ts
│   ["/api/*"]         │               (serves both static + API)
│ main: entry-cf.ts    │                      │
│  exports { fetch }   │                      │
└──────────┬──────────┘                      │
           │    Single deployment            │
           └──────────┬──────────────────────┘
                      ▼
                 Hono (app)
                      │
        ┌─────────────┼──────────────┐
        ▼             ▼              ▼
     Better Auth   Routes/Services   Drizzle ORM
     (auth)        (business logic)  (database)
                      │
                      ▼
                 @aws-sdk/client-s3
                 (presigned URLs)
                      │
                      ▼
             S3 / R2 (file storage)
```

## Core Tech Stack

| Layer | Choice | Alternatives Considered | Why This One |
|-------|--------|------------------------|--------------|
| Web Framework | **Hono** | Express, Fastify, ElysiaJS | Native CF Pages Functions + Node.js dual runtime. Lightweight, fast, web-standard Request/Response API |
| ORM | **Drizzle** | Prisma, Kysely | First-class D1 support, type-safe, SQL-like syntax, lightweight bundle for CF Pages Functions |
| Auth | **Better Auth** | Lucia, Auth.js, custom JWT | Drizzle adapter, D1 support, built-in social login / OIDC / organization plugin, active development |
| S3 SDK | **@aws-sdk/client-s3** | minio-js, custom fetch | Industry standard, works with every S3-compatible provider including R2 |
| Package Manager | **npm** | pnpm, yarn, bun | Standard, no extra tooling, Volta manages Node version |
| Frontend Framework | **React 19 + Vite** | Vue, Solid, Svelte | Largest ecosystem, Capacitor-ready for future native apps if needed |
| UI Components | **shadcn/ui + Tailwind CSS 4** | Ant Design, MUI | Zero runtime overhead (source code, not npm dep), best responsive/mobile support, modern aesthetic preferred by international users |
| Admin Scaffold | **[shadcn-admin](https://github.com/satnaing/shadcn-admin)** (11.6k stars) | Custom build | Fork as starting point for the **admin backend panel**. Includes sidebar, navigation, search, dark mode, responsive layout, settings pages. Same stack: Vite + TanStack Router + shadcn/ui. The user-facing frontend is custom-built |
| File Manager | **Custom** (shadcn/ui + @tanstack/react-table + @dnd-kit) | SVAR, @cubone/react-file-manager | List/grid views, directory tree, breadcrumb, context menu, drag-and-drop, file preview, type-safe, full control |
| Routing | **TanStack Router** | React Router, Next.js | Type-safe, lightweight, no framework lock-in. Included in shadcn-admin |
| Data Table | **TanStack Table** (via shadcn/ui Data Table) | AG Grid | Share management, user management, admin pages. Included in shadcn/ui |
| Icons | **Lucide** | Heroicons, Phosphor | Default icon set for shadcn/ui, consistent style |
| Forms | **react-hook-form + zod** | Formik | Lightweight, type-safe validation, shadcn/ui has built-in form components |
| File Upload UI | **react-dropzone** | Uppy, Filepond | Minimal, headless, composable with shadcn/ui. Community has ready-made shadcn upload blocks |
| Charts | **Recharts** (via shadcn/ui Charts) | Chart.js, D3 | For analytics dashboard (v2.8). Included in shadcn/ui |
| Notifications | **Sonner** (via shadcn/ui) | react-toastify | Upload feedback, copy-to-clipboard confirmations. Included in shadcn/ui |

## Frontend Architecture

### Off-the-shelf vs Custom

| Component | Source | Custom Work |
|-----------|--------|-------------|
| Layout, sidebar, navigation, dark mode | shadcn-admin | Minimal — adapt routes and menu items |
| File manager (list, grid, tree, drag-drop) | Custom (shadcn/ui + react-table + dnd-kit) | Built-in, path-based navigation |
| Upload dropzone | react-dropzone + shadcn blocks | Compose with presigned URL upload logic |
| Data tables (shares, users, storage) | shadcn/ui Data Table | Define columns and connect to API |
| Dialogs (share settings, file detail) | shadcn/ui Dialog/Sheet | Build forms inside pre-made shells |
| Global search | shadcn/ui Command | Connect to search API |
| Toast / notifications | shadcn/ui Sonner | Wire to upload events |
| **Share landing page** | **Custom** | Public page with file preview + download |
| **Upload history panel** | **Custom** | Recent uploads with URL copy |
| **Storage backend config forms** | **Custom** | S3 endpoint, credentials, path template |
| **Image bed quick-upload view** | **Custom** | Paste/drop → get URL, minimal UI |

Most of the heavy UI work is handled by existing components. Custom development focuses on ZPan-specific business pages.

## Project Structure

Single-package structure. Cargo workspace for Rust native tools (planned).

```
zpan/
├── server/                    # Hono API
│   ├── routes/                # API route handlers
│   ├── services/              # Business logic
│   ├── middleware/             # Hono middleware
│   ├── db/                    # Drizzle schema
│   ├── platform/              # CF vs Node.js adapters
│   ├── entry-node.ts          # Node.js entry point
│   └── auth.ts                # Better Auth config
├── src/                       # React frontend (Vite + shadcn/ui)
│   ├── components/            # UI components (files/, preview/, upload/, admin/, layout/)
│   ├── routes/                # TanStack Router file-based routing
│   ├── lib/                   # API client (Hono RPC), utils
│   └── i18n/                  # Translations (en.json, zh.json)
├── shared/                    # Shared types, Zod schemas, constants
├── functions/                 # CF Pages Functions entry
│   └── api/[[route]].ts       # CF entry point
├── migrations/                # D1/SQLite migrations (drizzle-kit generated)
├── e2e/                       # Playwright E2E tests
├── wrangler.toml              # Cloudflare Pages config
├── biome.json                 # Lint + format config
└── package.json               # Single package, npm
```

## API Communication

### Internal: Hono RPC (type-safe)

Frontend-to-backend calls use Hono's built-in RPC for end-to-end type safety. Changing a backend route automatically surfaces type errors in the frontend at compile time.

### External: Standard REST

PicGo, ShareX, Flameshot, zpan-cli, and third-party integrations use standard REST endpoints with token authentication. Same routes, just accessed without the RPC client.

### Data Fetching: TanStack Query

All frontend data fetching goes through TanStack Query for caching, loading states, optimistic updates, and pagination.

## Internationalization (i18n)

**react-i18next** for frontend translations. Default language: English. Bundled translations: English, Chinese (Simplified).

Translation files in `src/i18n/locales/{en,zh}.json`. Community can contribute additional languages via PR.

Backend error messages returned as i18n keys, frontend resolves to localized strings.

## Testing

| Layer | Tool | Scope |
|-------|------|-------|
| Unit tests | **Vitest** | Shared schemas, constants, utilities |
| Integration tests (Node) | **Vitest** + Hono `app.request()` | Route handlers, middleware, auth flows (better-sqlite3) |
| Integration tests (CF) | **Vitest** + `@cloudflare/vitest-pool-workers` | Same routes on Cloudflare Workers runtime (Miniflare + D1) |
| E2E tests | **Playwright** | Full user flows: login, navigation, file management |

Coverage gate: 90% on server. Playwright tests live in `e2e/` at the repo root, run against a local dev server.

## CI/CD

GitHub Actions:

**On PR:**
- `npm lint` — Biome lint + format check
- `npm typecheck` — TypeScript compilation
- `npm test` — Vitest unit + API tests
- `npm e2e` — Playwright tests

**On merge to master:**
- Build + deploy to CF Pages (preview / production)
- Build Docker image + push to Docker Hub (planned)

## Platform Abstraction

The only code that differs between CF and Docker:

```
src/platform/
├── interface.ts      # Platform interface definition
├── cloudflare.ts     # CF Workers: D1 binding
└── node.ts           # Node.js: better-sqlite3 / pg
```

### Interface

```typescript
interface Platform {
  db: Database    // D1 (CF) or better-sqlite3 (Node)
  getEnv(key: string): string | undefined
}
```

Note: `s3` and `cron` will be added in later versions.

### Entry Points

- `entry-cloudflare.ts` — exports `default { fetch }`, wrangler bundles it directly. Static frontend served by wrangler's `[assets]` config with SPA fallback. `run_worker_first = ["/api/*"]` routes only API requests to the worker.
- `entry-node.ts` — starts Hono via `@hono/node-server`, serves both API and static frontend from `../../dist` on the same port.

## Per-Version Technical Decisions

---

### v2.0 — Foundation

**Database: Drizzle + D1 / SQLite**

Schema definition in `src/db/schema.ts`, single source of truth. Drizzle Kit for migrations.

Tables: `matters`, `storages`, `storage_quotas`, `system_options` + Better Auth managed tables (`user`, `session`, `account`, `verification`).

**Auth: Better Auth (email/password only)**

Mounted at `/api/auth/*`. Session-based auth with secure cookies. Better Auth manages its own user/session tables — ZPan references the user ID in its own tables.

**Storage Provider: Unified S3 protocol**

One `@aws-sdk/client-s3` instance per storage backend. No per-provider SDKs (unlike v1 which had 8 separate implementations). All providers accessed via S3-compatible API.

Key operations:
- `PutObjectCommand` presigned URL for uploads
- `GetObjectCommand` presigned URL for downloads
- `HeadObjectCommand` for upload verification
- `CopyObjectCommand` for file copy
- `DeleteObjectCommand` / `DeleteObjectsCommand` for deletion

**File Path Templating**

Carried over from v1. Storage config includes `file_path` template with variables: `$UID`, `$UUID`, `$RAW_NAME`, `$RAW_EXT`, `$NOW_DATE`, `$RAND_16KEY`, etc.

**CORS**

v1 auto-configured CORS on storage setup via provider-specific SDKs. v2 drops this — document the required CORS config instead, since S3 CORS can be set via any S3 client or cloud console. Less magic, fewer provider-specific issues.

---

### v2.1 — Auth & Access

**Social Login: Better Auth built-in**

Configure via `socialProviders` in Better Auth config. Each provider needs `clientId` and `clientSecret` from env vars.

**OIDC: Better Auth Generic OAuth plugin**

```typescript
import { genericOAuth } from "better-auth/plugins"

genericOAuth({
  config: [{
    providerId: "company-sso",
    discoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
  }]
})
```

OIDC provider config stored in `system_options` table, editable via admin panel.

**Invite Codes**

New table `invite_codes` (`code`, `created_by`, `used_by`, `used_at`, `expires_at`). Registration mode stored in `system_options`. Better Auth `before` hook on sign-up validates invite code.

---

### v2.2 — Teams

**Better Auth Organization Plugin**

Direct use, no custom implementation needed.

```typescript
import { organization } from "better-auth/plugins"

organization({
  teams: { enabled: true },
  // custom roles for ZPan
})
```

**Custom Roles:**

```typescript
const statement = {
  file: ["upload", "download", "delete", "share"],
  workspace: ["manage", "invite"],
} as const

const ac = createAccessControl(statement)
const viewer = ac.newRole({ file: ["download"] })
const editor = ac.newRole({ file: ["upload", "download", "delete", "share"] })
const owner = ac.newRole({
  file: ["upload", "download", "delete", "share"],
  workspace: ["manage", "invite"],
})
```

**Data Model**

Organization plugin creates its own tables (`organization`, `member`, `invitation`). ZPan's `matters` table gets an optional `org_id` field — when set, the file belongs to the team workspace instead of the individual user.

**User Share Homepage**

Route: `GET /u/{username}` — server-side rendered page listing user's public shares. Data from `shares` table filtered by `uid` + a `public_profile` flag.

---

### v2.3 — Sharing

**Share Token Auth**

Public shares: no auth needed, accessible by alias.
Private shares: client sends password via `POST /api/shares/{alias}/token`, gets a short-lived JWT stored in cookie. Subsequent requests include this cookie.

**Direct Links**

`GET /s/{alias}` → returns the file itself (redirect to presigned S3 URL or public URL).
`GET /s/{alias}/info` → returns the share landing page with preview.

---

### v2.4 — Image Bed

**Upload API**

New endpoint `POST /api/upload` — simplified single-endpoint upload for tool integrations. Accepts `multipart/form-data` or presigned URL flow. Returns URL in requested format (raw, markdown, html, bbcode).

Separate from the existing `POST /api/matters` which is for the file manager UI (creates matter record first, then returns presigned URL).

**ShareX Compatibility**

ShareX Custom Uploader is a JSON spec (`.sxcu` file). ZPan generates this config file dynamically via `GET /api/integrations/sharex` with the user's API token embedded.

**PicGo Compatibility**

PicGo uses a simple REST API: `POST` with `multipart/form-data`, response includes `url` field. The same `/api/upload` endpoint handles this.

---

### v2.5 — Branding & Polish

**Site Branding**

Stored in `system_options` table under key `core.branding`: `{ logo, title, favicon, description }`. Frontend fetches on load via `GET /api/system/options/core.branding` (public endpoint).

**Custom File Domain**

`custom_host` field on storage backends. When set, presigned URLs and public URLs use this host. No server-side proxy — DNS points directly to S3/R2.

**Dark Mode**

Frontend-only, CSS variables + user preference stored in localStorage.

---

### v2.6 — Backup (zpan-cli)

**Location**: `native/crates/zpan-cli/` (same monorepo)

**Language: Rust**

Rust produces small (~5MB) static binaries for every platform (macOS, Linux, Windows, ARM). No runtime dependencies. Ideal for NAS environments.

Core logic lives in `zpan-core` crate, shared with the desktop app (v2.7).

**Rust crate dependencies:**
- `aws-sdk-s3` — S3 operations (upload, download, head, delete)
- `notify` — filesystem watching for real-time backup
- `tokio-cron-scheduler` — scheduled backup runs
- `clap` — CLI argument parsing
- `blake3` — fast file hashing for change detection
- `reqwest` — HTTP client for ZPan API calls
- `serde` / `serde_json` — serialization
- `tokio` — async runtime

**Sync Protocol**

CLI authenticates with ZPan via API token. Workflow:
1. Scan local directory, compute file hashes
2. `POST /api/sync/check` — send hashes, get back list of files needing upload
3. `POST /api/sync/batch-presign` — get presigned URLs for new/changed files
4. Upload directly to S3
5. `POST /api/sync/complete` — report uploaded files, ZPan updates matter records

**ZPan API additions:**
- `POST /api/sync/check` — file fingerprint comparison
- `POST /api/sync/batch-presign` — batch presigned URL generation
- `GET /api/sync/status` — backup job status for web UI

---

### v2.7 — Sync & Desktop App

**Change Log**

New table `changes` (`id`, `matter_id`, `action`, `path`, `hash`, `device_id`, `timestamp`). Every file create/update/delete writes a change record.

**Sync API:**
- `GET /api/sync/changes?since={id}&device={deviceId}` — pull changes from other devices
- `POST /api/sync/changes` — push local changes

**Conflict Strategy**

Default: keep both files. Remote version wins the original filename, local version renamed to `{name}.conflict-{device}-{date}.{ext}`. Optional `--conflict last-write-wins` flag for advanced users.

**Desktop App: Tauri 2**

Location: `native/crates/zpan-desktop/`. Ships alongside v2.7 as the graphical interface for backup + sync.

- Built with Tauri 2, frontend reuses React components from `src/`
- Core sync/backup logic imported from `zpan-core` crate (same code as CLI)
- System tray with status menu (backup status, sync status, pause, settings)
- Settings UI for configuring backup directories, sync folders, server connection
- Auto-start on login (OS-native)
- macOS, Windows, Linux builds via Tauri's cross-platform tooling

Tauri dependencies:
- `tauri` — app framework, system tray, window management
- `tauri-plugin-autostart` — launch on login
- `tauri-plugin-notification` — native notifications (sync conflict, backup complete)

---

### v2.8 — Managed Service

**Stripe: `stripe` npm package**

Webhook endpoint at `POST /api/webhooks/stripe` for subscription lifecycle events. Plan limits enforced in middleware (check user's plan before allowing operations).

**Analytics**

Managed version runs a separate analytics pipeline. Options:
- CF Analytics Engine (native, no extra infra)
- ClickHouse (Docker deployment)
- Simple approach: aggregate counters in D1/PostgreSQL with daily rollup cron

**Webhooks**

New tables: `webhook_endpoints` (`url`, `events`, `secret`) and `webhook_deliveries` (`endpoint_id`, `event`, `payload`, `status`, `attempts`). Delivery via CF Queue (managed) or Bull/BullMQ (Docker).

**Audit Log**

New table `audit_logs` (`user_id`, `action`, `resource_type`, `resource_id`, `metadata`, `timestamp`). Middleware writes audit entries on every mutating API call. Retention enforced by cron (7 days for Pro, 90 days for Team).

---

### v2.9 — Managed Advanced

**Content Moderation**

Upload hook triggers image classification. Options:
- CF Workers AI (managed deployment)
- External API (AWS Rekognition, Google Cloud Vision)

Flagged files stored in `moderation_queue` table for admin review.

**Server-side Processing**

Background worker (CF Queue consumer or separate container) handles:
- Archive extraction: stream zip from S3, extract entries, write back to S3
- Thumbnails: sharp / CF Image Resizing
- Format conversion: sharp for images

**Managed Custom Domains**

CF for SaaS (managed deployment) — programmatic custom domain provisioning via CF API. Creates custom hostname with automatic SSL.
