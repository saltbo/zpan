# Base62 ID normalization release runbook

This release is a breaking, maintenance-window migration. ZPan-owned opaque IDs and public tokens use the fixed alphabet
`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz` and must match `^[A-Za-z0-9]+$`. The runtime dispatches
public redirects only by the new `s`/`i` namespace prefix and has no legacy lookup, alias, or old/new format fallback.

Production execution is intentionally outside this change. Do not run any `wrangler ... --remote` command until a
maintainer has reviewed the dry-run statistics, secured backup, reconciliation report, and D1 SQL plan and has given a
new, explicit production approval.

## Observable release baseline

The implementation branch started from a clean worktree at `origin/main` commit
`50a9895fcf1c0aeb0811f889976cff2f4c1a554c`. Baseline lint, Node tests (261 files/5,403 tests), Cloudflare tests (18
files/81 tests), and both TypeScript projects passed. An early diagnostic wrapper reported non-zero because its zsh
snippet assigned to zsh's read-only `status` parameter after TypeScript had finished. This was a shell-wrapper error,
not a compiler error. A clean rerun of the repository command and both underlying commands returned zero:

```text
pnpm exec tsc --noEmit -p server/tsconfig.json
pnpm exec tsc --noEmit -p src/tsconfig.json
```

The inventory found 31 production files and 57 calls to default `nanoid()`. The repository guard now rejects any new
direct default `nanoid()` call in production roots.

## Inventory and ownership boundary

| Classification | Values | Migration action |
| --- | --- | --- |
| Must migrate: ZPan entity PKs | user, account, organization, member, invitation, OAuth client/resource/link row, matter, storage, share/recipient, audit event, notification, announcement, quota/entitlement, background job, downloader, download task/usage report, upload session, image, invite, WebDAV state row, traffic report, license binding, webhook row, x402 intent | Random old-to-new mapping for every non-Base62 value; update known references and embedded JSON. Audit event entity IDs are separated from `event_key`. |
| Must migrate: public/unique tokens | share and direct-download token, image token, site invite token, team invite token, invite code, image-domain verification token | Rotate every value, including already-alphanumeric legacy values. Shares become `s` + 11 random Base62 characters and images become `i` + 11 random Base62 characters. Old public links intentionally stop working. |
| Future generator plus historical scan | matter alias; dynamic OAuth registration management token | Migrate invalid aliases. Dynamic registration token hashes cannot be rewritten without plaintext, so registrations are invalidated and clients must re-register. |
| Structured business/event keys | `traffic_<id>`, `mutation:<id>`, `admin_grant:<id>`, storage ledger `event_key`, downloader event IDs, idempotency keys, webhook provider event IDs, stats rollup deterministic IDs | Not entity IDs. Preserve their structure. Update only typed local references: audit target/event keys, storage opening/matter/image keys, Free-plan source keys, and initial download-task event keys. Cloud/Webhook/downloader event IDs stay byte-for-byte unchanged because they are external idempotency identities. |
| Protocol identifiers | HTTP request UUID, WebDAV `opaquelocktoken:` URI, OAuth/PAR `urn:ietf:params:oauth:request_uri:` value, OAuth state/PKCE values, JWT `jti`/claims, JWK `kid` | Preserve protocol format. The Base62 PAR suffix is new, but the standards-defined URN remains a URI and is not validated as an opaque ID. |
| Natural/user-controlled keys | organization slug, username, email, filesystem path, object name, custom domain, provider ID | Preserve. These are meaningful identifiers, not opaque IDs. |
| External-system-owned values | S3 multipart `upload_id`, Cloud/Store order/resource/account/binding/attempt IDs, OAuth `client_id` and resource URI, provider account ID, external access/refresh/ID tokens | Do not rewrite. Inbound schemas remain protocol/provider appropriate. |
| Physical object references | `matters.object`, image `storage_key`, storage bucket/key/path | Do not rename objects. These persisted physical references continue to point to the existing object even when organization/matter/image IDs change. Reconciliation proves every referenced object remains accessible. |
| ID-derived avatar/logo objects | `user.image`, `organization.logo`, local `PUBLIC_IMAGES` keys (`user/<id>`, `team/<id>`), Cloud avatar owner IDs | If an owner ID needs mapping and an image/logo exists, fail before mutation. Export the affected owners, delete/clear the old hosted image while the old ID is authoritative, then re-upload after migration. The database-only tool never copies, deletes, or rebinds external R2/Cloud objects. Unrelated provider avatar URLs must still be reviewed and explicitly cleared/restored because the tool cannot prove their ownership from the URL alone. |
| Session and authorization artifacts | API keys, sessions, verification rows, device codes, downloader bootstrap credentials, downloader bearer credentials, task-upload grants, OAuth access/refresh tokens, consents, PAR rows, client assertions, server signing keys, dynamic registration management rows and their dynamic clients | Delete the credential rows listed by the tool. Downloader rows remain for history, but every stored token hash/JTI is rotated and the row is disabled, including IDs that were already Base62. Active task-upload states must be drained before mapping, so old task-upload tokens cannot remain usable. Users must sign in again and recreate API keys; downloaders must re-pair; OAuth clients must authorize again; dynamic clients must re-register. No synthetic compatibility tokens are created. |
| Cross-system instance identity | `system_options.instance_id` and active Cloud license binding | A locally rewritten value would orphan the Cloud-side binding. If it is non-Base62, stop and obtain a Cloud reconciliation decision: disconnect/rebind under a new Base62 instance ID or coordinate an external mapping. The local migration must not silently rewrite it. |
| Pending cross-system usage/purchase state | pending/failed/blocked/skipped/dead-letter Cloud usage, non-reported remote-download usage, unfinished x402 purchases, Cloud-order entitlements | If a referenced local ID needs mapping, fail before creating the mapping table. Drain, cancel, or reconcile the external operation first. Historical provider event/idempotency IDs are never rewritten locally. |
| Active Cloud customer identity | organization IDs used as Cloud/Store customer and order targets while a license binding is active | If any organization ID would change while an active binding exists, fail before mutation. Production requires a separately approved Cloud-side mapping/rebind; this tool never changes Cloud data. |
| In-flight local/external work | queued/running archive jobs and their Cloudflare Queue messages; active multipart upload sessions; assigned/downloading/uploading download tasks | Fail before mutation. Drain the Queue and finish/cancel the DB job, complete or abort each S3 multipart upload, and drain/cancel task-upload work before taking the snapshot. Queue messages cannot be rewritten atomically with D1 and multipart `upload_id` values belong to S3. Re-enqueue only from normalized DB state after deployment. |
| Runtime cache entries | distributed image-domain `host -> orgId`; in-process WebDAV/storage caches whose keys or values contain local IDs | The image-domain distributed cache policy is versioned from v1 to v2, making every old KV entry unreachable by the new runtime. In-process caches disappear with the old deployment. Keep old runtime instances stopped through the cutover and verify the first post-deploy image-domain lookup is a source/v2-cache result. |

Existing physical object references stay unchanged during migration, but every future key allocation uses a guarded builder.
Ordinary object, WebDAV, archive, copy, transfer, and downloader uploads use
`<Base62 org ID>/<Base62 owner user ID>/<YYYYMMDD>/<17 Base62 random characters><extension>`. Image-hosting uploads use
`ih/<Base62 org ID>/<13-character Base62 image ID>.<MIME-derived extension>`. The `/` separators and filename extension
are S3 key structure, not opaque IDs. Key construction fails before an upload is presigned or written if an ID component
is not Base62.

The inventory included `nanoid`, `customAlphabet`, `randomUUID`, and `randomBytes` calls; schema PKs/FKs/unique tokens;
OpenAPI path parameters; clients/scripts/tests/docs; audit/notification/job JSON; R2/S3 physical keys; cache and idempotency
keys; OAuth claims/PAR; and Cloud/Store API identifiers. Better Auth 1.7 core IDs and session tokens are Base62, but its
organization plugin owns separate organization, member, and invitation create hooks and otherwise produces default
21-character Nano IDs with `_`/`-`. ZPan configures Better Auth's supported `advanced.database.generateId` hook and all
three organization hooks with the same central generator. A database contract test covers user, account, organization,
member, invitation, and session IDs plus session tokens.
Better Auth API keys use a Base62 custom generator; caller prefixes containing punctuation are rejected. Because stored
API-key hashes cannot be rewritten, all historical keys are intentionally revoked by the maintenance migration.

## Generator entropy and collision budget

The central generator is cryptographically secure Nano ID `customAlphabet` with a fixed 62-character alphabet. Default
entity IDs are 22 characters: `22 × log2(62) = 130.99` bits, above the previous default Nano ID's 126-bit budget.

| Length | Entropy | Use | Approximate birthday collision probability |
| ---: | ---: | --- | ---: |
| 10 | 59.54 bits | invite code | `6.0e-11` at 10,000 active codes; `6.0e-7` at 1,000,000 total generated codes |
| 11 | 65.50 bits | matter alias; random suffix of share/image public tokens | `9.6e-9` at 1,000,000 values in one namespace |
| 12 total | 65.50 random bits | `s` + 11 random Base62 for shares; `i` + 11 random Base62 for images | `9.6e-9` at 1,000,000 tokens in either disjoint namespace |
| 13 | 77.41 bits | image row ID | `2.7e-12` at 1,000,000 rows |
| 22 | 130.99 bits | default entity ID | negligible at projected scale |
| 32/33 | 190.53/196.48 bits | team/site/PAR/verification token | negligible |
| 43 | 256.04 bits | OAuth registration management token | above 256 bits |

Unique database constraints remain the final collision guard within each resource. The fixed `s` and `i` prefixes make
the public redirect namespaces disjoint without a cross-resource lookup or redirect table.

## Mapping algorithm and safety properties

`pnpm ids:normalize` operates on a SQLite database or an exported D1 replica.

1. Dry-run is the default and rolls back its control tables and all tentative changes.
2. Apply requires a new backup pathname; the tool uses SQLite's online backup API and sets mode `0600`.
3. `_zpan_id_normalization_map(kind, old_value, new_value)` stores random mappings with unique constraints. It never
   removes or substitutes punctuation.
4. The SQLite apply uses one transaction. It writes `validation_version=2` and `completed_at` only after every validation
   succeeds. Once both markers exist, reruns are validation-only: they do not rotate
   tokens or invalidate credentials created after the release.
5. PKs and direct references are updated by an explicit table/column inventory. Polymorphic references use their
   `target_type`, `actor_type`, `scope_type`, `resource_type`, or traffic `source`. JSON uses only an explicit,
   context-aware key-to-entity map, so external IDs that happen to equal a local old ID remain unchanged. Known audit,
   storage-ledger, Free-plan, and initial-task structured keys are parsed by format; no global substring replacement is
   used. Physical object keys and protocol/external identifiers are excluded.
   Audit, change-log, completed upload/task, usage-ledger, and rollup rows can legitimately outlive the entity they
   describe. Invalid historical references are assigned a stable pseudonym in the same mapping kind; already-Base62
   historical pseudonyms are retained. They are format-checked but are not misrepresented as live foreign keys. Empty
   ledger sentinels remain empty and are never added to the mapping table.
6. Credential/session tables listed above are invalidated explicitly. Dynamic OAuth client rows with registration
   management credentials are removed; statically configured clients remain. Every downloader token hash/JTI is
   replaced and the downloader is disabled even when its historical ID was already Base62.
7. Validation checks row counts, uniqueness through constraints, `PRAGMA foreign_key_check`, zero illegal governed
   values, exact `s`/`i` public-token prefixes and lengths, live direct and typed-polymorphic target existence, typed JSON
   reference formats/targets according to their historical or live semantics, and structured upload creators. Any
   failure aborts the transaction. Legacy download tasks whose creator was stored as `api-key:<id>` are resolved to the
   API-key owner before the API-key rows are intentionally invalidated.
8. `--emit-d1-sql` writes the exact reviewed mapping and rewritten JSON to a mode-`0600` SQL plan. The plan has persistent
   `CHECK (violations = 0)` assertions for expected row counts, foreign keys, formats, exact rewritten values, logical
   references, and public-token namespace formats. The versioned completion marker is the last state change; a missed update or
   unversioned pre-existing marker aborts without blessing the database. It contains sensitive
   old and new public tokens; never attach it to a PR or paste it into logs. Mapping inserts and review assertions are
   packed into deterministic chunks below a 90,000-byte budget. Exact JSON/polymorphic rewrites are staged in
   `_zpan_id_normalization_exact_values` and applied per governed column, instead of emitting one D1 command per row.
   Generation fails before writing the plan if any SQL statement reaches D1's 100,000-byte limit or the complete plan
   exceeds 1,000 statements. A database with an individually oversized rewritten JSON value or a plan that still needs
   more statements requires a separately engineered phased migration; the tool never emits a known-unexecutable plan.

The runtime startup gate is intentionally O(1) after migration: it requires both versioned proof markers instead of
rescanning every large table on each Workers isolate cold start. A populated database without the proof fails fast.
The expensive zero-invalid and logical-integrity scans are part of the maintenance transaction and D1 assertion plan;
all future application writes use the central generator and narrowed schemas.

Only counts are printed to stdout. Old/new values exist only in the protected backup, map table, and optional protected
D1 plan.

## Local rehearsal

Use a disposable database path. Never point these commands at a shared staging or production database.

```sh
pnpm ids:normalize -- --sqlite ./representative-copy.db

pnpm ids:normalize -- \
  --sqlite ./representative-copy.db \
  --apply \
  --backup ./representative-copy.pre-id-normalization.db \
  --emit-d1-sql ./id-normalization.d1.sql
```

Confirm the backup and D1 plan are mode `0600`. Re-run the apply against the migrated copy; every mapping count must be
zero. Restore the backup to a new path and compare row counts and business invariants. Do not overwrite the only backup.

For a D1 rehearsal, export a representative database into a private local directory, construct a SQLite replica, apply
the generated `0092_audit-event-key` schema migration to the replica, produce the D1 plan above, then execute that plan
against a fresh Wrangler **local** D1 database. Run the validation queries below against both the normalized SQLite copy
and local D1. The automated test also replays the emitted plan against an independent legacy fixture.

The release rehearsal performed on 2026-08-04 used isolated temporary directories only and never supplied Wrangler's
`--remote` flag. It applied all 92 migrations, loaded the representative legacy fixture, completed dry-run and apply,
created mode-`0600` backup/plan artifacts, and replayed 635 plan commands (including 496 persistent machine assertions) on a second
fresh local D1 database. A second replay was semantically idempotent. Both SQLite and D1 returned zero foreign-key
failures and zero invalid share/image tokens; credentials were deleted or deterministically disabled, direct,
polymorphic, JSON, notification, and both user/downloader upload-creator references matched their mapped entities, and
Cloud event IDs plus S3 object/image/multipart storage references stayed byte-for-byte unchanged. The backup retained
the old IDs, public token, object keys, and session row, proving the documented full-restore rollback point.

## Release verification evidence

Final local gates on 2026-08-04 passed with:

- lint plus the uncontrolled-ID-generation guard; repository `typecheck` and each TypeScript project independently;
- 268 Node unit/integration files with 5,485 tests, all passing;
- coverage thresholds at 85.28% statements, 76.06% branches, 76.99% functions, and 88.11% lines;
- 18 Cloudflare files/81 tests and the libSQL project (1 file/6 tests);
- dependency architecture (370 modules/1,509 dependencies), HTTP boundary, and 434-scenario spec traceability;
- OpenAPI/client and Drizzle schema drift checks, plus Workers, Node, Lambda, Vercel, Netlify, and Azure builds.

The complete Playwright run was also attempted locally: 91 passed, 9 failed, and 1 was not run. The failures were
environmental or unrelated to this change: no S3 service at the repository's default `localhost:9000`, no Cloud Store
business/licensing credentials (shared staging was explicitly prohibited), an announcement control disabled by local
license state, and two existing responsive-preview callback races. The affected upload, private download, public share,
profile share, image hosting, and image-domain flows were then run against an isolated local S3 mock: all 33 passed.
This Draft must not be promoted until the mandatory CONTRIBUTING preview verification is run in an approved isolated
preview environment with its own Cloud/S3 credentials.

## Production maintenance procedure (requires new approval)

1. Announce a write outage and prevent all API, WebDAV, background-job, Queue-consumer, and downloader writes. Stop all
   old runtime isolates/processes; their in-process caches and old writers must not run while identifiers are changing.
2. Capture a D1 export/backup and the provider's restore point. Record checksums, row counts, migration journal, and the
   maintenance timestamp outside the database.
3. Drain/cancel queued or running archive jobs and purge/ack their old Cloudflare Queue messages. Complete or abort every
   active S3 multipart upload. Drain/cancel assigned, downloading, or uploading download tasks. Scan
   `system_options.instance_id`, ID-owning avatar/logo rows, Cloud-order entitlements, pending usage reports,
   remote-download usage, and x402 intents. If any invalid local identity participates in active external state, stop
   for the reconciliation decision described in the inventory table. Export the avatar/logo owner list, delete or clear
   the old R2/Cloud objects while old IDs still work, and plan post-cutover re-upload.
4. On the private exported replica, apply migration `0092`, dry-run the normalizer, then apply with backup and emit the
   D1 plan. Review counts and diff the inventory against expected intentional invalidations.
5. Rehearse that exact plan on a fresh local D1 copy. Verify row counts, unique constraints, foreign keys, zero-invalid
   scans, public routes, object reads, and the application test suite.
6. After a maintainer gives a new explicit approval, apply migration `0092` to production, execute the protected plan as
   the exact reviewed batch in the maintenance window, and immediately run reconciliation. **Do not split the plan by
   table or statement:** PK and logical-reference rewrites cross table boundaries. If the rehearsal exceeds a D1 batch,
   statement, or transaction limit, stop; a separate shadow-table/phased migration must be engineered, reviewed, and
   approved before production.
7. Confirm both `validation_version=2` and `completed_at` exist only after all D1 assertion rows report zero. Deploy the
   new runtime only after reconciliation passes. The v2 image-domain cache namespace prevents legacy KV hits; verify the
   first domain lookup loads normalized state. Keep writes disabled until smoke tests prove share, image, object, quota,
   audit, job, WebDAV, downloader, and OAuth behavior. Re-upload reconciled avatars/logos and re-enqueue only normalized
   archive work.
8. Notify users that old share/image/invite links are invalid, sessions require login, API keys must be recreated,
   OAuth grants require authorization, dynamic clients require registration, and downloaders must re-pair. Drain or
   pause assigned/in-flight download tasks before the snapshot; after migration reconcile each task, requeue safe work,
   and issue new downloader/task-upload credentials only after the corresponding downloader has re-paired. An encrypted
   operator-only mapping export may support targeted notification; it must never power runtime fallback.
9. Securely delete the D1 SQL plan after the rollback window. Retain the encrypted backup per the incident policy.

## Reconciliation queries and invariants

Run `PRAGMA foreign_key_check;` and require zero rows. Require every row in
`_zpan_id_normalization_assertions` to have `violations=0`. For every governed table/column, require this shape to return zero:

```sql
SELECT COUNT(*)
FROM <table>
WHERE <column> IS NULL
   OR <column> = ''
   OR <column> GLOB '*[^A-Za-z0-9]*';
```

Nullable governed tokens omit the `IS NULL` branch. Public redirect tokens use stricter scans:

```sql
SELECT COUNT(*)
FROM shares
WHERE length(token) != 12
   OR substr(token, 1, 1) != 's'
   OR substr(token, 2) GLOB '*[^A-Za-z0-9]*';

SELECT COUNT(*)
FROM image_hostings
WHERE length(token) != 12
   OR substr(token, 1, 1) != 'i'
   OR substr(token, 2) GLOB '*[^A-Za-z0-9]*';
```

Both must return zero. Compare before/after counts for every table, allowing decreases only in the documented invalidation
tables. Check every live non-null direct, typed-polymorphic, typed-JSON, and structured creator reference resolves;
historical pseudonyms must be Base62 and preserve same-kind equality without requiring a deleted target. Unique PK/token counts equal row counts; audit `event_key` is
unique; JSON parses; object keys are byte-for-byte unchanged; referenced storage objects can be read; quota totals and
stats rollups are unchanged; and the normalization completion marker exists.

## Rollback

Before the data apply, rollback is simply the prior application build. After any mapping or invalidation statement has
run, stop writes and restore the complete database backup/restore point, then deploy the prior build. Do not try to
reverse mappings in place: deleted session/OAuth/verification material cannot be reconstructed, JSON could have changed,
and a partial inverse would violate the no-dual-format invariant. Re-run row counts, foreign keys, object reads, and old
public-link checks on the restored database before reopening traffic.

Old public links are a deliberate breaking change. There is no runtime redirect, legacy alias table, or fallback lookup.
