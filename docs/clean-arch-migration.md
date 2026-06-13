# Clean Architecture Migration (hono-cf-clean-arch)

Living tracker for migrating `server/` to the canonical layout: `domain → usecases
→ adapters → http`, with a `composition.ts` root and `dependency-cruiser`
enforcement. Strangler-style: **every commit is behavior-preserving and leaves
`pnpm typecheck` + `pnpm test` green.** One PR, many green commits.

## Target layout

```
server/
  domain/          pure business rules (no node_modules except shared/)
  usecases/        application operations; take `deps` first
    ports.ts       barrel re-exporting ports/<resource>.ts
    ports/         framework-free port interfaces + DTOs (one file per resource)
    deps.ts        the Deps aggregate
  adapters/
    repos/         drizzle repositories (the ONLY place schema/drizzle is imported)
    gateways/      external services that aren't HTTP-API providers (s3, email, …)
    providers/     external HTTP API clients
  http/            hono routes (already split per resource); get deps from context
  auth.ts          better-auth (named drizzle exception)
  composition.ts   createDeps(platform): the only place adapters are constructed
  db/              drizzle schema + client
```

## Conventions (the recipe applied per resource)

1. Port: `usecases/ports/<r>.ts` — plain DTOs + repo/gateway interface. No drizzle,
   no zod runtime (type-only shared imports OK). Add `export * from './ports/<r>'`
   to `usecases/ports.ts`.
2. Adapter: `adapters/repos/<r>.ts` — `create<R>Repo(db): <R>Repo`. Maps rows → DTOs.
3. Wire: add to `usecases/deps.ts` (the `Deps` interface) and `composition.ts`.
4. Rewire callers:
   - `http/` + middleware → `c.get('deps').<r>.<method>(...)`
   - not-yet-migrated `services/` / `auth.ts` → `create<R>Repo(db).<method>(...)`
     (transitional; removed when that service itself migrates)
5. Delete the old `services/<r>.ts`; move its co-located data tests next to the repo.
6. `pnpm typecheck && pnpm lint && pnpm test` green; commit.

Imports: relative within `server/` (matches existing code); `@shared/*` for shared.

## Progress

### Done
- [x] **Step 1** `routes/ → http/` rename
- [x] **Backbone** `composition.ts` + `usecases/deps.ts` + `usecases/ports/` + deps middleware
- [x] `activity` → `adapters/repos/activity.ts` (ActivityRepo)
- [x] `storage` → `adapters/repos/storage.ts` (StorageRepo)
- [x] `profile` → ProfileRepo; `buildBreadcrumb` → `domain/breadcrumb.ts`
- [x] `announcement` → AnnouncementRepo
- [x] `notification` → NotificationRepo
- [x] **test infra**: `createApp(platform, auth, deps?)` + `createTestApp` returns
      `deps`, so tests fake a port by spying on `testApp.deps.<x>` (replaces
      cross-boundary module spies, e.g. events SSE unread-count failure)

- [x] `org` → OrgRepo (authz queries) · `invite` → InviteRepo
- [x] `background-jobs` → BackgroundJobRepo (+ BackgroundJobError to ports)
- [x] `effective-quota` → QuotaRepo (`currentTrafficPeriod` → domain/quota); unblocks
      team / storage-usage / matter / cloud-traffic-metering. 14 callers + entry-node
      + workers/scheduled rewired.

- [x] `team` → TeamRepo (uses QuotaRepo internally) · `team-invite` → TeamInviteRepo
- [x] `site-invitations` → SiteInvitationRepo · `cf-custom-hostnames` → CfHostnamesProvider
      · `changelog` → ChangelogProvider · `instance`/license-binding → InstanceRepo/LicenseBindingRepo
      · `s3` → S3Gateway (shim) · `system-options` → SystemOptionsRepo · `image-hosting-config` → ImageHostingConfigRepo
- [x] `user` + `org-entitlements` -> UserAdminRepo (combined; resolves the user/org-entitlements cycle)
- [x] `storage-usage` → StorageUsageRepo + reserve/withReservation usecase (the quota-reservation crown foundation)

### Parallel migration waves (file-disjoint components migrated concurrently by subagents; barrels wired by the orchestrator)
All waves done. Each wave: agents migrated disjoint components (new ports/adapters/usecases/domain,
rewired callers to `c.get('deps')`), the orchestrator wired the 3 barrels and ran the gates.
- [x] **Wave 1** — instance-telemetry, image-upload, archive-jobs, zip-compress/extract, object-upload-sessions, purge
- [x] **Wave 2** — auth-account (signup-mode-guard, team-count-guard, captcha, email, share-notification),
      webdav-middleware (download-tokens, api-keys, webdav-state/path/xml), cloud (licensing-cloud, cloud-store,
      cloud-traffic-metering→cloud-traffic-report, remote-download-usage, licensing-refresh-runner), branding, image-hosting
- [x] **Wave 3** — share + save-to-drive, archive-processing (+archive-target-folder), trash-retention
- [x] **Wave 4** — the **matter keystone** (MatterRepo + matter usecase + matter-name-conflict→domain) + site-public-origin
- [x] **Wave 5** — downloads (DownloaderRepo + DownloadTaskRepo + state-machine usecase); then the **s3 shim deleted**

### Status: COMPLETE — architecture fully locked
`server/services/` is empty and removed. Every drizzle access lives in `adapters/repos/`; every route
gets its dependencies from `c.get('deps')`. **The ratchet is empty and removed** — including the final two
files: `http/webdav.ts` (listDescendants/proppatch/PUT-overwrite/Basic-Auth → MatterRepo.{listActiveDescendants,
trashByIds,restoreActiveByIds,touch,applyUpload} + UserAdminRepo.{isBanned,matchesUsername}) and
`middleware/auth.ts` (disabled-user check → UserAdminRepo.isBanned). Gates green: `typecheck`,
`lint:arch` (267 modules, **no-circular + drizzle-only-in-repos fully enforced, zero exemptions**),
`lint:spec`, `lint`, `test` (3810), `test:cf` (57).

### Enforcement — DONE, fully locked
- [x] `.dependency-cruiser.cjs` + `lint:arch` in CI. All clean-arch rules active with **no migration allowlist**.
- [x] `platform/` (Database driver type), `server/test`, and `auth.ts` (better-auth owns its tables) are the only
      permanent named exceptions to `drizzle-only-in-repos`.

### Product specs (BDD-lite) — DONE
- [x] `spec/` Gherkin `.feature` (one per capability) + `spec/README.md`; `[spec: <id>]` breadcrumbs on home
      tests; `pnpm lint:spec` (CI) enforces traceability both ways.
- [x] **376 scenarios across 26 capabilities**: storages, announcements, notifications, invite-codes,
      site-invitations, quotas, profile, licensing, users, audit, teams, avatar, background-jobs, events, health,
      branding, email-config, auth-providers, system, image-hosting, webdav, quota-store, redirect, download-tasks,
      shares, objects.

### Optional follow-ups (not blocking; tracked for later)
- [ ] Remove the ~21 pre-existing dead `const db = c.get('platform').db` locals (non-blocking biome warnings).
