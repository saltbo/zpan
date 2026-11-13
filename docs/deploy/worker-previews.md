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
Wrangler selects `previews` bindings when publishing a Preview. Local development uses the top-level bindings simulated by Wrangler,
with local variables and secrets from `.dev.vars`; no named local environment is needed.

Following the [official D1 migration workflow](https://developers.cloudflare.com/workers/previews/resources/#d1-migrations),
`wrangler.preview-migrations.json` declares the migration target separately. Its
database ID must match `previews.d1_databases` in `wrangler.toml`. Preview migrations run before upload, separately
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
Staging Cloud issues each Preview a certificate for its exact hostname; ZPan
accepts staging-signed certificates only for `<label>.saltbo.workers.dev` hosts
(see [license key trust](../design/license-key-trust.md)).

Preview secrets added to Base apply to **new** Previews. Update existing Preview
secrets explicitly when rotating them.

## Auth secrets on the shared staging D1

Every Preview reads and writes the same `jwks` table. better-auth encrypts the
JWKS private key with the auth secret, so a Preview whose secret cannot decrypt
the stored key returns 500 from `POST /api/auth/oauth2/token` with
`Failed to decrypt private key` (see #607).

Rules:

- Set `BETTER_AUTH_SECRET` and `BETTER_AUTH_SECRETS` **only** in Previews Base
  config. Never run `wrangler preview secret put BETTER_AUTH_SECRET` (or
  `BETTER_AUTH_SECRETS`) for a single Preview.
- Cloudflare copies Base secrets into a Preview when it is created. Existing
  Previews keep their old values, so a Base change must be followed by updating
  or redeploying every live Preview.
- Never set `jwks.disablePrivateKeyEncryption`; it stores signing keys in
  plaintext.

`BETTER_AUTH_SECRETS` is an optional comma-separated list of
`<version>:<secret>` entries, current version first, for example
`2:<new>,1:<old>`. better-auth encrypts new data with the first entry and
decrypts with any listed version. `BETTER_AUTH_SECRET` stays required: it is the
legacy key for data written before versioning (bare, unversioned ciphertext)
and the key ZPan derives its own short-lived page/download tokens from. The same
variables work on Workers, Node, and Docker; with only `BETTER_AUTH_SECRET` set,
behavior is unchanged.

### Rotation runbook

1. Generate the new value with `openssl rand -base64 32`. Do not paste it into
   PRs, issues, or logs.
2. Leave `BETTER_AUTH_SECRET` unchanged.
3. Set `BETTER_AUTH_SECRETS` to the new version **prepended** to every version
   still in use. To adopt versioning without signing anyone out, first set
   `1:<current BETTER_AUTH_SECRET value>`; a later rotation becomes
   `2:<new>,1:<old>`. Keep old versions listed until no stored data depends on
   them:

   ```bash
   pnpm exec wrangler preview base-config secret put BETTER_AUTH_SECRETS
   ```

4. Update every live Preview the same way, or redeploy it, before relying on the
   new version. Previews that still hold the previous list can decrypt
   everything except data encrypted with the new version, so finish this step
   quickly.
5. Verify on a Preview: sign in as `reviewer@zpan.dev` and complete one OAuth
   authorization-code flow; `/api/auth/oauth2/token` must return 200.
6. Retire a version only after the keys and other data encrypted with it have
   been replaced. Session cookies are signed with the current version only, so
   changing the current version signs users out once.

### Recovering an undecryptable JWKS (staging only)

If the stored key was encrypted with a secret no deployment holds any more,
back up the `jwks` rows on the staging D1, delete the undecryptable row, and let
better-auth create a new key on the next token request. Never do this on
production without an incident plan: existing id_tokens stop verifying.

#### Spotting it in Workers Logs

The first time a Worker isolate hits `Failed to decrypt private key`, ZPan
checks every stored `jwks` row against the secrets that deployment holds and
logs **one** line (at most once per isolate, so a broken key cannot flood the
logs). The request itself still fails exactly as before; nothing is changed or
deleted. The line never contains private keys or secret values:

```text
auth.jwks.decrypt_failed keys=1 undecryptable=[{"id":"<jwks-id>","alg":"EdDSA","expired":false,"encryptedWith":"v1","tried":"none","reason":"version_not_configured"}] configured_versions=[2]
```

- `encryptedWith`: which secret encrypted the row — `legacy`
  (`BETTER_AUTH_SECRET`), `v<n>` (`BETTER_AUTH_SECRETS` version `n`), or
  `unknown` when the stored value cannot be parsed.
- `tried`: the secret this deployment used for the check
  (`BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS v<n>`, or `none`).
- `reason`: `version_not_configured` (the row's version is not listed in this
  deployment's `BETTER_AUTH_SECRETS`), `decrypt_failed` (the secret is listed
  but holds a different value), or `unreadable`.
- `configured_versions`: the `BETTER_AUTH_SECRETS` versions this deployment
  lists (`[]` when only `BETTER_AUTH_SECRET` is set).
- `check_error` replaces `keys`/`undecryptable` if the rows could not be read.

To find it, open the Worker in the Cloudflare dashboard → **Workers Logs** and
search for `auth.jwks.decrypt_failed`. A Preview logs under the same Worker, so
filter by the Preview's version or the time of the failing token request. The
same line appears in Node/Docker stderr.

Each `id` in `undecryptable` is a candidate for `--id` below. Before deleting,
check whether a secret fix is enough instead (for example a Preview missing a
version that Base config lists — update or redeploy that Preview).

#### Resetting the rows

`pnpm reset:preview-jwks` codifies these steps. It only accepts the Preview D1
(`PREVIEW_DB` / `zpan-db-staging` in `wrangler.preview-migrations.json`, which
must match `[[previews.d1_databases]]` in `wrangler.toml` and differ from every
production D1) and refuses any other target before calling Wrangler.

1. List the rows (dry run, the default; nothing is changed). Each row shows
   which secret encrypted it: `legacy BETTER_AUTH_SECRET`,
   `BETTER_AUTH_SECRETS v<n>`, or `plaintext`. Private keys are never printed.

   ```bash
   pnpm reset:preview-jwks
   ```

2. Pick the rows no deployed secret can decrypt — for example a legacy row
   after `BETTER_AUTH_SECRET` changed, or a `v<n>` row whose version is no longer
   listed in `BETTER_AUTH_SECRETS`. Preview the deletion:

   ```bash
   pnpm reset:preview-jwks --id <jwks-id>
   ```

3. Back up and delete with an explicit `--confirm`. The script writes the
   selected rows to `.local/preview-jwks-backups/jwks-<timestamp>.json`
   (mode 0600, git-ignored; it holds encrypted private keys, so do not share it),
   deletes them, and checks that they are gone. `--all` selects every row.

   ```bash
   pnpm reset:preview-jwks --id <jwks-id> --confirm
   ```

4. Verify as in step 5 of the rotation runbook: one OAuth authorization-code
   flow on a Preview must return 200 from `/api/auth/oauth2/token`. id_tokens
   signed with a deleted key stop verifying; sign in again.

Wrangler runs as `pnpm exec wrangler` with your Cloudflare credentials; set
`WRANGLER_COMMAND` to use another wrapper. `--config` and `--backup-dir`
override the defaults (the target guard still applies).

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
