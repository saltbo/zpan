# Worker Previews

Use Cloudflare Workers Builds for production and branch previews. There is no
separately deployed `zpan-staging` Worker in the target setup.

| Builds setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `pnpm build` |
| Production deploy command | `pnpm db:migrate:d1:prod && pnpm exec wrangler deploy` |
| Preview command | `pnpm deploy:preview` |
| Preview builds | Enabled |

Do not set `CLOUDFLARE_ENV=staging` in Builds. Vite builds the top-level Worker;
Wrangler selects `previews` bindings when publishing a Preview. `env.local` is
only for local development and must not be deployed.

The `previews.d1_databases` binding and `wrangler.preview-migrations.json` must
point at the same database ID. Preview migrations run before upload, separately
from production migrations. All branches share staging data; incompatible schema
changes require coordination or a separate database, not concurrent migrations
against the shared database.

## One-time transition

1. Upgrade dependencies and validate local checks and build output.
2. Configure Previews Base secrets with the existing **test** credentials. Secrets
   are not inherited from production. Use `pnpm exec wrangler preview base-config
   secret put NAME`; do not copy local development secrets into deployed assets.
3. In Workers Builds, review the existing commands and choose **Set up Worker
   Previews**. Cloudflare documents this as an irreversible switch of preview model.
   Apply the settings above and remove old staging environment overrides.
4. Deploy and verify the new Previews before removing the old Worker. Check
   login, database and storage isolation, and cross-project integration.
5. Remove the old `zpan-staging` Worker only after its callers and callback
   registrations have moved. Preserve staging D1, KV, and R2 data.

A Preview URL stays stable while its Preview exists. Keep the Cloud `staging`
branch active and retain its Preview. Cloudflare can evict least-recently-deployed
Previews when account-plan limits are reached; a branch name alone is not a
permanent reservation. Do not delete the staging Preview in branch cleanup.

## Integration

ZPan Previews connect to `https://staging-zpan-cloud.saltbo.workers.dev`.
Cloud's production branch remains `master`; the long-lived `staging` branch
selects the tested Cloud revision used by all ZPan Previews. Update it deliberately
when validating a new Cloud revision. Development branches get their own Previews.

Configure test GitHub OAuth and Stripe webhook registrations for the Cloud staging
Preview hostname, including `/api/auth/callback/github` and
`/api/auth/stripe/webhook`. Arbitrary Cloud branch hostnames are not automatically
registered with external OAuth providers. Use staging for full external-provider
verification. Preview authentication uses the request origin; verify each ZPan
instance's authorized hosts and Cloud fulfillment callback URL when pairing.

Preview secrets added to Base apply to **new** Previews. Update existing Preview
secrets explicitly when rotating them.

## Preview limitations

Previews do not receive Cron events or consume Queue messages. ZPan Previews omit
the archive Queue binding and explicitly reject archive creation/retries before
persisting tasks. The file manager hides archive actions. Node/local execution
and production Queue handling remain available.

Cloud maintenance is run on demand as described below. ZPan's automatic license
refresh, usage reconciliation and other scheduled tasks are not automatically
executed in Previews. Request-driven functionality is still available; record
this limitation in preview verification reports.

## Run Cloud maintenance manually

Sign in as an administrator on the Cloud staging Preview. Send a same-origin POST
with the admin session cookie and `Origin: https://staging-zpan-cloud.saltbo.workers.dev`:

| Endpoint | Action |
| --- | --- |
| `/api/admin/preview-tasks/commerce-cleanup` | Expire/clean up commerce state and process eligible fulfillment |
| `/api/admin/preview-tasks/publication-health` | Probe publication health |
| `/api/admin/preview-tasks/github-sync` | Refresh GitHub Offers eligibility facts |

These routes are enabled only by `WORKER_PREVIEW=true`, require the existing
administrator permission check, and reject cross-origin requests. They return the
selected task's result and fail when its operation fails. They use the same task
functions as production Cron. No scheduler or second CI pipeline is required.

A request can be sent with an authenticated HTTP client or from a same-origin
operator tool; do not put session cookies in source control or PR comments.

## Local verification

Run each project's documented lint, typecheck, unit/integration and browser checks.
Inspect the generated Wrangler configuration: the Worker name must remain
`zpan`, production DB IDs must remain at the top level, and only staging IDs
must appear under `previews`. For Cloud, run `pnpm cf-typegen` after config changes.
