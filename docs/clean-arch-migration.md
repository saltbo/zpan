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

### Repos to extract (drizzle services → adapters/repos)
- [ ] api-keys, background-jobs, branding, captcha
- [ ] download-tokens, object-upload-sessions, storage-usage
- [ ] share-notification, invite, site-invitations, site-public-origin
- [ ] org, org-entitlements, team, team-invite, team-count-guard, user
- [ ] matter, matter-name-conflict, share, effective-quota
- [ ] cloud-store, cloud-traffic-metering, remote-download-usage, download (downloads/core)
- [ ] image-hosting, save-to-drive, archive-processing, archive-jobs, zip-compress/extract
- [ ] webdav-path, webdav-state, instance-telemetry, signup-mode-guard

### Licensing subsystem
- [ ] `domain/licensing.ts` (hasFeature, effectiveFeatures) + `LicenseBindingRepo`
      (license-state) + `loadBindingState` usecase + CertVerifier; instance-id/info,
      refresh, entitlement

### Gateways (fetch / SDK) → adapters/gateways|providers
- [ ] s3, email, cf-custom-hostnames, changelog, cloud-store SDK

### Routes with inline drizzle → repos + deps
- [ ] auth-providers, ihost, ihost-config, me, quotas, shares, system, teams, webdav

### Domain extractions (pure logic)
- [ ] path-template, content-disposition (shared already), webdav-xml, url-safety (shared),
      mime-utils, constant-time, password, semver

### Final enforcement
- [ ] Move `Database` type into `db/` (keep drizzle out of `platform/`)
- [ ] Add `.dependency-cruiser.cjs` + `lint:arch` script + wire into CI
- [ ] Delete emptied `services/`; remove transitional shims
- [ ] `pnpm lint:arch` green
