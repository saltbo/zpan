import { sql } from 'drizzle-orm'
import type { Database } from '../platform/interface'

const STATE_TABLE = '_zpan_id_normalization_state'
const VALIDATION_VERSION = '2'

// The release tool performs the expensive format, FK, JSON, and logical-reference
// scans before it writes this versioned marker. Runtime startup deliberately checks
// only that proof: repeating full-table GLOB scans on every Worker isolate would make
// cold-start cost proportional to the whole database.
const OCCUPANCY_TABLES = [
  'user',
  'account',
  'session',
  'verification',
  'jwks',
  'organization',
  'member',
  'invitation',
  'apikey',
  'deviceCode',
  'oauthClient',
  'oauthClientRegistration',
  'oauthResource',
  'oauthClientResource',
  'oauthRefreshToken',
  'oauthAccessToken',
  'oauthConsent',
  'oauthClientAssertion',
  'oauthPushedAuthorizationRequest',
  'oauthJwtRevocation',
  'downloader_bootstrap_credentials',
  'matters',
  'webdav_dead_properties',
  'webdav_locks',
  'storages',
  'org_quotas',
  'storage_usage_breakdowns',
  'cloud_traffic_reports',
  'org_quota_entitlements',
  'webhook_events',
  'x402_capacity_purchase_intents',
  'invite_codes',
  'site_invitations',
  'license_bindings',
  'team_invite_links',
  'shares',
  'share_recipients',
  'audit_events',
  'resource_changes',
  'stats_rollups_hourly',
  'storage_usage_ledger',
  'notifications',
  'announcements',
  'background_jobs',
  'downloaders',
  'download_tasks',
  'object_upload_sessions',
  'remote_download_usage_reports',
  'image_hosting_configs',
  'image_hostings',
  'system_options',
] as const

export async function assertNormalizedIdentifiers(db: Database): Promise<void> {
  const stateTable = await db.all<{ present: number }>(
    sql.raw(`SELECT COUNT(*) AS present FROM sqlite_master WHERE type = 'table' AND name = '${STATE_TABLE}'`),
  )
  const state = stateTable[0]?.present
    ? await db.all<{ key: string; value: string }>(
        sql.raw(`SELECT key, value FROM "${STATE_TABLE}" WHERE key IN ('completed_at', 'validation_version')`),
      )
    : []
  const values = new Map<string, string>(state.map((entry: { key: string; value: string }) => [entry.key, entry.value]))
  const completed = values.get('completed_at')

  if (completed) {
    if (values.get('validation_version') !== VALIDATION_VERSION) {
      throw new Error('id_normalization_validation_marker_missing')
    }
    return
  }

  // Sum scalar EXISTS expressions rather than using UNION ALL: D1's compound
  // SELECT limit is lower than the number of governed tables.
  const occupancy = await db.all<{ occupied: number }>(
    sql.raw(
      `SELECT ${OCCUPANCY_TABLES.map((table) => `EXISTS(SELECT 1 FROM "${table}" LIMIT 1)`).join(' + ')} AS occupied`,
    ),
  )
  if (Number(occupancy[0]?.occupied ?? 0) > 0) {
    throw new Error('id_normalization_not_completed')
  }

  await db.run(sql.raw(`CREATE TABLE IF NOT EXISTS "${STATE_TABLE}" (key TEXT PRIMARY KEY, value TEXT NOT NULL)`))
  await db.run(
    sql.raw(
      `INSERT INTO "${STATE_TABLE}" (key, value) VALUES ('validation_version', '${VALIDATION_VERSION}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),
  )
  await db.run(
    sql.raw(
      `INSERT INTO "${STATE_TABLE}" (key, value) VALUES ('completed_at', '${Date.now()}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),
  )
}
