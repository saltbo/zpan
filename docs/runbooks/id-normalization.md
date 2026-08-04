# ID normalization release runbook

This runbook is destructive. It requires a separate, explicit production approval. The
implementation and tests do not run `wrangler d1 execute --remote` or mutate production.

## Prepare and dry-run

1. Record the application commit and current D1 migration version. Announce a maintenance
   window that covers database rewrite, credential invalidation and post-release checks.
2. Export a recoverable production backup with `wrangler d1 export <database> --remote
   --output pre-id-normalization.sql`. Store it according to the incident-recovery policy and
   test importing it into a new local D1 database.
3. Import the export into an isolated SQLite/D1 rehearsal database. Apply migration
   `0092_base62_audit_event_key.sql`, `0093_redirect-token-registry.sql`, and
   `0094_redirect-token-kind-resource.sql` to the rehearsal
   copy first; the old application can tolerate the nullable audit column and unused registry,
   while the planner intentionally refuses a database without them. Then run:

   ```sh
   pnpm ids:backfill -- --sqlite rehearsal.sqlite \
     --plan-file id-normalization.sql \
     --batch-file id-normalization-batch.json \
     --mapping-file id-normalization-map.json
   ```

   All output files are sensitive plaintext, created with mode 0600, and refuse to overwrite
   an existing file. Encrypt them at rest under the incident-recovery policy and delete them
   after the observation window. The console prints counts only, never old/new values.
4. Review counts, malformed-JSON failures, external binding/downloader impact, and the secure
   share/image/invite mapping export with the operations owner. Resolve any direct-share/image
   token collision before proceeding.

## Maintenance-window apply

1. Stop writes and background consumers. Confirm no upload, WebDAV, download, quota, webhook,
   or OAuth request can write during the rewrite. Take a second export and record row counts.
2. Apply migrations `0092_base62_audit_event_key.sql`, `0093_redirect-token-registry.sql`, and
   `0094_redirect-token-kind-resource.sql`
   while the old application remains quiesced, export again, and regenerate the plan from that
   exact post-migration snapshot.
   Do not reuse a plan from an earlier snapshot.
3. On a local SQLite deployment, apply with the explicit credential acknowledgement:

   ```sh
   pnpm ids:backfill -- --sqlite zpan.sqlite --apply \
     --confirm-credential-invalidation \
     --mapping-file id-normalization-map.json
   ```

   The same transaction writes `id_normalization_pending_artifact_digest` from the exact plan.
   The breaking application accepts that verified observation-window checkpoint. Local rollback
   removes it; local finalize moves the exact value to `id_normalization_applied_artifact_digest`
   while writing `id_normalization_version=1`.

4. On D1, do **not** pass the SQL file to `wrangler d1 execute`: file execution is not the
   atomicity boundary this migration requires. The approved maintenance executor must load
   the exact generated JSON statement array and submit all statements in one `env.DB.batch()`.
   D1 keeps foreign keys enabled; the first statement is `PRAGMA defer_foreign_keys = ON`.
   Copy `wrangler.id-backfill.example.toml` outside the repository, replace both D1 placeholders,
   and have a second operator verify that they identify the clone. The dedicated template has no
   application routes, assets, queues, cron triggers, or service bindings. Deploy it with
   `pnpm wrangler deploy --config /secure/path/wrangler.id-backfill.toml`, then set its secret with
   `pnpm wrangler secret put ID_BACKFILL_AUTH_TOKEN --config /secure/path/wrangler.id-backfill.toml`.
   Never use the application's default `wrangler.toml` for this executor. Then POST the generated artifact
   with `Authorization: Bearer …`, `X-ZPan-ID-Backfill-Confirm:
   invalidate-credentials-and-links`, and `X-ZPan-ID-Backfill-Digest: <artifact.digest>`.
   The executor verifies the SHA-256 digest, completion marker, a 47-statement artifact ceiling,
   and statement-size/first-statement contract before issuing exactly one `env.DB.batch()`.
   That same batch records the pending
   artifact digest; a retry of the identical artifact is a no-op and a different artifact is
   rejected. The ceiling leaves three queries for preflight and the pending-digest insert under
   D1 Free's 50-query invocation cap; JSON rewrites are coalesced into size-bounded CASE updates.
   The response contains only the digest and statement count. Delete
   the Worker after the rehearsal. Repeat the same executor and exact artifact in the approved
   production window; never expose it through the application Worker.

   Rehearse that exact artifact through the one-shot Worker against an isolated D1 clone and
   prove both successful commit and injected-failure rollback. The checked-in CF test proves
   the executor's digest gate plus representative PK/FK, structured key, JSON, public-token,
   credential invalidation and rollback behavior; the clone rehearsal proves the exact
   database-sized artifact. If the exact artifact exceeds request, batch, CPU, statement,
   or database limits, **do not apply it to the serving database**. The planner fails before
   writing when it cannot fit the exact snapshot into the safe one-batch ceiling. Use the
   offline new-database procedure below instead; never split an in-place rewrite into batches.
5. Run the planner again in dry-run mode. It must report zero invalid IDs/tokens, zero
   ambiguous redirects, zero credentials awaiting invalidation, and zero JSON rewrites.
   Run `PRAGMA foreign_key_check`, compare every pre/post table row count except documented
   credential tables, check all unique indexes, and reconcile quota/audit/job invariants.
6. Deploy the breaking application build. Re-register downloaders, rotate JWKS through normal
   authentication startup, require users to sign in again, and require OAuth clients and
   social-login accounts to authorize again. Provider access/refresh/ID tokens are cleared,
   while credential password hashes and provider account linkage remain. Rebind ZPan Cloud if
   the instance ID changed; its local binding is deliberately marked disconnected.
7. Notify link owners that old share, image and invite URLs are invalid. Use the encrypted-at-
   rest mapping export only for notification/export; do not serve redirects from it. Every
   public token is rotated, including values that were already alphanumeric.

D1 limits and behavior should be rechecked immediately before the production window:
[limits](https://developers.cloudflare.com/d1/platform/limits/),
[foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/),
[SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/), and
[import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## D1 snapshots above the atomic query ceiling

An exact artifact above 47 statements is a supported release shape, but only through an
offline blue-green database replacement. This path does not mutate the old D1 database and
therefore does not need runtime old/new compatibility or an unsafe partially normalized state.
Every remote command and the final binding switch still require separate production approval.

1. Keep the application and every consumer quiesced from the final export until the binding
   switch is accepted. Record a D1 Time Travel bookmark and export the exact post-0094 database.
   The old D1 database is the immutable rollback point; do not apply the generated D1 artifact
   to it.
2. Import that export into local SQLite, run `pnpm ids:backfill -- --sqlite ... --apply
   --confirm-credential-invalidation`, perform all pre/post invariants, and run `--finalize`.
   This uses one local SQLite transaction without D1's per-invocation query ceiling. Repeat from
   the untouched export after an injected interruption and prove that only the complete result
   survives. The finalized database must contain `id_normalization_version=1`, no pending digest
   and no mapping table.
3. Convert the normalized SQLite database to D1-compatible SQL. Follow Cloudflare's documented
   SQLite `.dump` procedure exactly: remove the outer `BEGIN TRANSACTION`/`COMMIT` and the
   `_cf_KV` statements. Preserve the source export, normalized SQLite file, final SQL, SHA-256
   digests, table row counts and verification report as separate encrypted release artifacts.
4. Create a **new, empty, unbound** D1 database and import the normalized SQL with Wrangler.
   Cloudflare currently accepts import files up to 5 GiB; split larger imports according to the
   current official procedure. Because this target serves no traffic, a failed or interrupted
   import is discarded and recreated instead of resumed in place. For a split import, record
   the expected and actual row count after every file, and do not proceed to the next file on a
   mismatch. Do not bind the target to an application until the final global checks pass.
5. Re-export the new D1 database and compare every table row count with the normalized local
   source. Run `foreign_key_check`, zero-invalid ID/token scans, redirect-registry consistency,
   uniqueness checks and business invariants against the re-export. Rehearse the new application
   against this isolated target using a maintenance-only configuration.
6. In one reviewed deployment, switch the application D1 binding to the new database and deploy
   the breaking application. Keep writes stopped while read-only routing, authentication
   invalidation and representative reads are checked. If any check fails, restore the previous
   application deployment and old database binding; the old D1 is unchanged. Open writes only
   after explicit release acceptance. Once writes open, reverting to the old database would lose
   accepted writes and requires a separately approved reconciliation; prefer a forward fix.
7. Retain the old D1, exports and digests through the observation window. Delete the replacement
   attempt on any pre-switch failure. Do not run old and new applications concurrently, replicate
   writes, or add legacy token lookup during this process.

Cloudflare D1 export blocks other requests while it runs, import/export has format constraints,
and Time Travel restore is destructive and in-place. Reconfirm those current platform semantics,
limits and retention immediately before approval; do not treat this runbook as authority to run
the remote commands.

## Rollback and reconciliation

Do not finalize until the release owner accepts post-deploy verification.

- Before credential invalidation or any uncertain D1 partial execution, the authoritative
  rollback is to restore the quiesced pre-change export and redeploy the previous application.
- While `_zpan_id_backfill_map` remains, `pnpm ids:backfill -- --sqlite zpan.sqlite --rollback`
  reverses mapped IDs/tokens and embedded references for local recovery. Deliberately deleted
  credentials are not reconstructible; restore the backup if they are needed.
- For D1, generate/review reversal from the applied snapshot or restore the backup into a new
  database and switch bindings according to the D1 recovery procedure. Never run old and new
  applications concurrently against a partially reversed database.
- Reconcile S3/R2 objects by stored `object`/`storage_key`; those keys are intentionally not
  renamed. Reconcile Cloud binding state manually because Cloud-owned IDs are not rewritten.

After the observation window, verify again and drop the checkpoint:

```sh
pnpm ids:backfill -- --sqlite zpan.sqlite --finalize
```

For D1, keep the same temporary maintenance Worker bound to the quiesced database and POST
`{"version":1,"digest":"<artifact.digest>"}` to `/finalize` with the same bearer secret and
`X-ZPan-ID-Backfill-Confirm: finalize-id-normalization`. The executor rechecks all foreign keys,
the Base62 ID/token scans and redirect-registry consistency; requires the
mapping checkpoint and exact pending digest to exist; and atomically writes both the completion
version and applied artifact digest before dropping the mapping table. Credentials created by
the new application during the observation window are allowed; invalidation of pre-migration
credentials is proven in the apply artifact rehearsal. Its CF test
proves completion and repeat-finalize rejection. Remove the maintenance Worker immediately
   after the successful response with
   `pnpm wrangler delete --config /secure/path/wrangler.id-backfill.toml`.

D1 rejects `PRAGMA integrity_check` through its prepared API. Run that check on the exact
exported SQLite rehearsal snapshot before finalization; the live D1 finalizer uses the
supported foreign-key and semantic scans listed above.

Finalization removes the local mapping table and therefore removes mapping-based rollback;
the retained database export remains the disaster-recovery point. It atomically writes
`system_options.id_normalization_version=1`; later dry-run/apply/finalize attempts fail fast
instead of rotating public tokens a second time.
