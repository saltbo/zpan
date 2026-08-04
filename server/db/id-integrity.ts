import { ID_NORMALIZATION_DATA_TABLES } from '@shared/id-normalization-inventory'
import { sql } from 'drizzle-orm'
import type { Database } from '../platform/interface'

const ID_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'jwks',
  'organization',
  'member',
  'invitation',
  'apikey',
  'deviceCode',
  'oauthClient',
  'oauthResource',
  'oauthClientResource',
  'oauthRefreshToken',
  'oauthAccessToken',
  'oauthConsent',
  'oauthPushedAuthorizationRequest',
  'downloader_bootstrap_credentials',
  'matters',
  'webdav_dead_properties',
  'webdav_locks',
  'storages',
  'org_quotas',
  'cloud_traffic_reports',
  'org_quota_entitlements',
  'webhook_events',
  'x402_capacity_purchase_intents',
  'invite_codes',
  'site_invitations',
  'license_bindings',
  'team_invite_links',
  'notifications',
  'background_jobs',
  'downloaders',
  'download_tasks',
  'object_upload_sessions',
  'remote_download_usage_reports',
  'announcements',
  'audit_events',
  'stats_rollups_hourly',
  'storage_usage_ledger',
  'shares',
  'share_recipients',
  'image_hostings',
] as const

const TOKEN_COLUMNS = [
  ['matters', 'alias'],
  ['invite_codes', 'code'],
  ['site_invitations', 'token'],
  ['team_invite_links', 'token'],
  ['shares', 'token'],
  ['image_hostings', 'token'],
  ['image_hosting_configs', 'verification_token'],
  ['downloaders', 'token_jti'],
] as const

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
const invalid = (column: string) => `${quote(column)} = '' OR ${quote(column)} GLOB '*[^A-Za-z0-9]*'`
const COMPLETION_VERSION = '1'
const DIGEST_PATTERN = /^[0-9a-f]{64}$/

type ReleaseCheckpoint = { key: string; value: string }

function validateReleaseCheckpoint(rows: ReleaseCheckpoint[]): boolean {
  const completion = rows.find(({ key }) => key === 'id_normalization_version')
  const pending = rows.find(({ key }) => key === 'id_normalization_pending_artifact_digest')
  if (completion && completion.value !== COMPLETION_VERSION) {
    throw new Error(`id_integrity_checkpoint_invalid:id_normalization_version`)
  }
  if (pending && !DIGEST_PATTERN.test(pending.value)) {
    throw new Error(`id_integrity_checkpoint_invalid:id_normalization_pending_artifact_digest`)
  }
  return completion !== undefined || pending !== undefined
}

function markFreshEmptyDatabaseSql(): string {
  const emptyPredicates = ID_NORMALIZATION_DATA_TABLES.map(
    (table) => `NOT EXISTS (SELECT 1 FROM ${quote(table)} LIMIT 1)`,
  )
  emptyPredicates.push("NOT EXISTS (SELECT 1 FROM system_options WHERE key = 'instance_id' LIMIT 1)")
  return `INSERT INTO system_options (key, value)
SELECT 'id_normalization_version', '${COMPLETION_VERSION}'
WHERE ${emptyPredicates.join(' AND ')}
ON CONFLICT(key) DO NOTHING
RETURNING key, value`
}

export function idIntegrityScanSql(): string[] {
  return [
    ...ID_TABLES.map(
      (table) =>
        `SELECT ${literal(`${table}.id`)} AS field, COUNT(*) AS count FROM ${quote(table)} WHERE ${invalid('id')}`,
    ),
    ...TOKEN_COLUMNS.map(
      ([table, column]) =>
        `SELECT ${literal(`${table}.${column}`)} AS field, COUNT(*) AS count FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL AND (${invalid(column)})`,
    ),
    "SELECT 'system_options.instance_id' AS field, COUNT(*) AS count FROM system_options WHERE key = 'instance_id' AND (value = '' OR value GLOB '*[^A-Za-z0-9]*')",
    "SELECT 'redirect_token_registry.token' AS field, COUNT(*) AS count FROM redirect_token_registry WHERE token = '' OR token GLOB '*[^A-Za-z0-9]*'",
    "SELECT 'redirect_token_registry.resource_id' AS field, COUNT(*) AS count FROM redirect_token_registry WHERE resource_id = '' OR resource_id GLOB '*[^A-Za-z0-9]*'",
  ]
}

export const AMBIGUOUS_REDIRECT_SQL =
  "SELECT COUNT(*) AS count FROM shares s INNER JOIN image_hostings i ON i.token = s.token WHERE s.kind = 'direct' AND s.status = 'active' AND i.status = 'active'"

export const REDIRECT_REGISTRY_INTEGRITY_SQL = `SELECT COUNT(*) AS count FROM redirect_token_registry r
WHERE (r.kind = 'direct_share' AND NOT EXISTS (
  SELECT 1 FROM shares s WHERE s.kind = 'direct' AND s.id = r.resource_id AND s.token = r.token
)) OR (r.kind = 'image_hosting' AND NOT EXISTS (
  SELECT 1 FROM image_hostings i WHERE i.id = r.resource_id AND i.token = r.token
)) OR r.kind NOT IN ('direct_share', 'image_hosting')
UNION ALL
SELECT COUNT(*) AS count FROM shares s
WHERE s.kind = 'direct' AND NOT EXISTS (
  SELECT 1 FROM redirect_token_registry r WHERE r.kind = 'direct_share' AND r.resource_id = s.id AND r.token = s.token
)
UNION ALL
SELECT COUNT(*) AS count FROM image_hostings i
WHERE NOT EXISTS (
  SELECT 1 FROM redirect_token_registry r WHERE r.kind = 'image_hosting' AND r.resource_id = i.id AND r.token = i.token
)`

export async function assertIdIntegrity(db: Database): Promise<void> {
  let releaseCheckpoint = (await db.all(
    sql.raw(
      "SELECT key, value FROM system_options WHERE key IN ('id_normalization_version', 'id_normalization_pending_artifact_digest')",
    ),
  )) as ReleaseCheckpoint[]
  // The D1 maintenance executor writes the pending digest atomically with the
  // backfill and finalize replaces it with the completion marker after full
  // semantic scans. Avoid repeating unindexed release scans on every isolate.
  if (validateReleaseCheckpoint(releaseCheckpoint)) return

  const initialized = (await db.all(sql.raw(markFreshEmptyDatabaseSql()))) as ReleaseCheckpoint[]
  if (initialized.length > 0) return
  // A concurrent isolate may have installed the same empty-database marker.
  releaseCheckpoint = (await db.all(
    sql.raw(
      "SELECT key, value FROM system_options WHERE key IN ('id_normalization_version', 'id_normalization_pending_artifact_digest')",
    ),
  )) as ReleaseCheckpoint[]
  if (validateReleaseCheckpoint(releaseCheckpoint)) return
  const scans = idIntegrityScanSql()
  const rows: Array<{ field: string; count: number }> = []
  // D1 caps compound SELECT terms below SQLite's upstream default, so keep each
  // release-boundary scan comfortably below that limit.
  for (let offset = 0; offset < scans.length; offset += 5) {
    rows.push(
      ...((await db.all(sql.raw(scans.slice(offset, offset + 5).join(' UNION ALL ')))) as Array<{
        field: string
        count: number
      }>),
    )
  }
  const failures = rows.filter(({ count }) => count > 0)
  const ambiguous = (await db.all(sql.raw(AMBIGUOUS_REDIRECT_SQL))) as Array<{ count: number }>
  if ((ambiguous[0]?.count ?? 0) > 0) failures.push({ field: 'redirect_tokens.ambiguous', count: ambiguous[0]!.count })
  const registryFailures = (await db.all(sql.raw(REDIRECT_REGISTRY_INTEGRITY_SQL))) as Array<{ count: number }>
  const registryFailureCount = registryFailures.reduce((total, row) => total + row.count, 0)
  if (registryFailureCount > 0) failures.push({ field: 'redirect_tokens.registry', count: registryFailureCount })
  if (failures.length > 0) {
    throw new Error(`id_integrity_failed:${failures.map(({ field, count }) => `${field}=${count}`).join(',')}`)
  }
  // A non-empty database cannot prove that already-Base62 public tokens were
  // rotated or credentials invalidated through value scans alone. Only the
  // rehearsal-backed apply/finalize flow may establish that release boundary.
  throw new Error('id_normalization_checkpoint_required')
}
