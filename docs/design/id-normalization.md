# Identifier normalization

## Release boundary

ZPan-owned persistent entity identifiers and public opaque tokens use the fixed alphabet
`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz` and satisfy
`^[A-Za-z0-9]+$`. This is a breaking, maintenance-window migration: historical values are
backfilled before the new application starts. Runtime code contains no legacy lookup,
prefix parser, or old-to-new alias table.

The central generator is `shared/ids.ts`. A repository lint rejects imports of Nano ID's
default `nanoid()` generator from production and operational source and permits reviewed
`customAlphabet()` use only for the central generator, organization slugs, and usernames.
Set-based SQLite inserts use `randomblob()` encoded as Base16 (or deterministic hex of a
canonical JSON tuple for rebuildable stats rows); these values are cryptographically random
or injective, ASCII alphanumeric, and cannot call a TypeScript generator inside SQL. Better Auth remains on its upstream
database-ID generator because Better Auth 1.7 already uses `a-zA-Z0-9`; replacing it would
couple ZPan to authentication internals without changing the contract.

## Entropy budget

Base62 provides `log2(62) = 5.954` bits per character. Lengths were rounded up when replacing
Nano ID's 64-character alphabet, so entropy never decreases.

| Use | Old entropy | New format | New entropy |
| --- | ---: | --- | ---: |
| Default entity ID | Nano ID 21, 126 bits | Base62 22 | 131.0 bits |
| Share / matter alias | Nano ID 10, 60 bits | Base62 11 | 65.5 bits |
| Image ID | Nano ID 12, 72 bits | Base62 13 | 77.4 bits |
| Image public token | prefixed/default Nano ID, at most 60 bits | Base62 12 | 71.4 bits |
| Short filename suffix | Nano ID 4, 24 bits | Base62 5 | 29.8 bits |
| Invite code | upper alphanumeric 8, 41.4 bits | Base62 8 | 47.6 bits |
| OAuth PAR suffix | Nano ID 32, 192 bits | Base62 33 | 196.5 bits |
| Registration management token | 32 random bytes, 256 bits | Base62 43 | 256.0 bits |

The collision budget uses `p ≈ n(n-1)/(2 × 62^length)`:

| Namespace | Population assumption | Approximate collision probability | Guard |
| --- | ---: | ---: | --- |
| 8-char invite codes | 100,000 simultaneously retained codes | `2.3e-5` | unique index; conflict fails the create |
| 11-char share/alias tokens | 10,000,000 retained tokens | `9.6e-7` | unique index; `/r` tokens reserve a shared registry row in the resource transaction and retry bounded collisions |
| 12-char image tokens | 10,000,000 retained tokens | `1.5e-8` | unique index; same transactional `/r` registry and bounded retry |
| 22-char entity IDs | 1,000,000,000 retained IDs | `1.8e-22` | primary/unique key |

The shortest token is a one-time invite code and its active population is expected to stay
well below the stated 100,000-code budget. A collision never aliases an existing resource:
the database rejects it. Entity IDs have a materially larger margin.

## Repository-wide inventory

The baseline audit found 57 direct default `nanoid()` calls in 31 production files. The
following table classifies generators and persisted or embedded values by ownership. “Migrate”
means the one-time backfill rewrites historical values. “Future only” means the value is not
an opaque entity ID, but its random component now uses the central generator.

| Class | Values and locations | Action |
| --- | --- | --- |
| ZPan entity primary IDs | matters, storages, quotas/entitlements, invites, notifications, jobs, downloaders/tasks, upload sessions, usage reports, announcements, audit/stat/ledger rows, shares/recipients, image hosting, WebDAV state, license binding, webhook/x402/cloud report rows | Migrate PK plus references; all creation paths use `generateId()` |
| Better Auth entity IDs | user, account, organization, member, invitation, API key, OAuth client/resource linking rows | Verify/migrate any historical exception; retain upstream Base62 generator and contract tests |
| Public opaque tokens | matter alias, invite code, site/team invite, share, image-hosting, image-domain verification, downloader JTI, instance ID | Migrate; all new values are Base62 |
| Direct-share `ds_` token | share token and `/r/:token` | Replace with 11-char Base62; reserve the shared redirect registry in the share transaction, then resolve database ownership and fail closed on any integrity mismatch |
| Image public token | image-hosting public token | Replace with 12-char Base62 without a semantic prefix; reserve the same registry namespace transactionally and derive resource type from the database |
| Event/source/idempotency keys | `traffic_<id>`, `admin_grant:<id>`, `mutation:<id>`, ledger event keys, webhook event IDs | Future random component uses Base62 where ZPan generates it; separators remain because these are structured business keys, not entity IDs |
| Object/cache keys | R2/S3 `object`, `storage_key`, image paths, cache keys, file paths | Do not rename. The database stores the authoritative key, so remapping a row ID does not move the object |
| JSON/polymorphic references | notification/job/audit/resource-change/stat/API-key metadata; `ref_id`, `target_id`, `scope_id`, `resource_id`, actor refs | Rewrite exact mapped values; malformed JSON fails the plan before mutation |
| Cloud / Store / ZPan Cloud identifiers | binding/store/account IDs, cloud event IDs and raw webhook payloads | External system owns them; never rewrite. If the instance ID changes, disconnect the local binding and reconcile/rebind explicitly |
| Better Auth credentials | sessions, verification, JWKS, device codes, OAuth grants/access/refresh tokens, consent, PAR, JWT revocations, registration management credentials, and provider access/refresh/ID tokens stored on accounts | Invalidate or clear during maintenance; require login/re-authorization/key rotation instead of synthesizing compatibility; password hashes and provider linkage remain |
| Downloader credential claims | PASETO subject/JTI and bootstrap credentials | Disable downloader and delete bootstrap credentials; re-register to issue claims over the new ID |
| HTTP request ID | `crypto.randomUUID()` | Protocol/observability identifier; preserve UUID |
| WebDAV lock token | `opaquelocktoken:${crypto.randomUUID()}` | WebDAV URI token; preserve standard format |
| Object challenge ID | UUID inside a signed upload challenge | Signed protocol field; preserve until challenge expiry |
| OAuth request URI | `urn:ietf:params:oauth:request_uri:<Base62>` | Preserve registered URN prefix; only the opaque suffix changes |
| Signed page cursor / share child ref | ZPan-owned transient public opaque references | Encode a versioned signed binary envelope as Base62; legacy Base64url/dotted forms expire at the release boundary with no dual decoder |
| OAuth state, PKCE, JWT claims | provider-owned Base64url, URIs and signed claims | Protocol-owned; do not apply the entity-ID regex |
| Cryptographic salt/hash/random bytes | password salts, secret hashes, signatures | Cryptographic encoding boundary; preserve |
| UI-only IDs | transient React list/chip keys using UUID | Ephemeral and not persisted; preserve |

## Backfill invariants

The planner builds random old-to-new mappings; it never strips or substitutes punctuation.
One invalid entity value maps to one stable replacement across PK/FK and embedded references.
Table-scoped JSON handling rewrites scalar and array ID keys used by notifications, archive
jobs, audit and quota attribution, plus notification share tokens from the share-token
namespace; arbitrary strings and external IDs are left untouched.
Token mappings remain table-scoped, while candidate generation and the durable
`redirect_token_registry` enforce one shared namespace for direct-share and image `/r` tokens.
Mappings live only in `_zpan_id_backfill_map`, an operational checkpoint table that runtime
code never reads. Finalization drops it after verification.

Apply runs with foreign keys enabled and deferred inside one SQLite transaction. It checks
database integrity, foreign keys, zero illegal values, redirect ambiguity, and unchanged row
counts for every table except explicitly invalidated credential tables. The generated D1 plan
keeps each statement under D1's 100 KB statement limit and is re-entrant through `INSERT OR
IGNORE`. For a production D1 database, the application must be quiesced and the exact
generated statement array must succeed in one rehearsed `D1Database.batch()` transaction;
Wrangler SQL-file execution and ad hoc multi-batch splitting are not supported. No online
mixed-format phase exists.

The planner coalesces reference assignments by table and JSON rewrites into size-bounded CASE
updates. It refuses artifacts above 47 statements, leaving the executor's three preflight and
checkpoint queries within D1 Free's 50-query invocation cap. Empty, representative cross-table,
and 1,000-document JSON fixtures assert this ceiling; an oversized fixture proves fail-fast
without mutation. Snapshots above the ceiling use the runbook's offline normalized-new-D1 import
and application binding switch, with the untouched old D1 as the pre-write rollback point. They
are never divided into in-place batches. After an exact artifact is applied, its
digest is the cheap startup checkpoint; the full unindexed scans run in the maintenance
finalizer rather than on every new Worker isolate.

Every public share/image/invite token is rotated, including already-alphanumeric values, so
old links intentionally stop working. The optional
0600 mapping export supports owner notification or a controlled link-export process, but must
never be deployed as a runtime lookup table.
