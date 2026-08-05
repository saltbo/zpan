import { Buffer } from 'node:buffer'
import { chmodSync, existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { BASE62_PATTERN, generateId, generateImageToken, generateShareToken, generateToken } from '../shared/ids'

const MAP_TABLE = '_zpan_id_normalization_map'
const STATE_TABLE = '_zpan_id_normalization_state'
const EXACT_VALUE_TABLE = '_zpan_id_normalization_exact_values'
const VALIDATION_VERSION = '2'
const D1_MAX_STATEMENT_BYTES = 100_000
const D1_STATEMENT_BUDGET_BYTES = 90_000
const D1_MAX_COMMANDS = 1_000

interface Reference {
  table: string
  column: string
  allowDangling?: boolean
}

interface MappingSource extends Reference {
  predicate?: string
}

interface ValueSpec {
  kind: string
  table: string
  column: string
  length: number
  rotateAll?: boolean
  references?: Reference[]
  mappingSources?: MappingSource[]
}

export interface NormalizationSummary {
  apply: boolean
  mappings: Record<string, number>
  invalidated: Record<string, number>
  credentialsInvalidated: Record<string, number>
  jsonDocumentsUpdated: number
  polymorphicReferencesUpdated: number
  structuredKeysUpdated: number
  rowCountsVerified: number
}

const ref = (table: string, column: string, allowDangling = false): Reference => ({
  table,
  column,
  ...(allowDangling ? { allowDangling } : {}),
})

// This is deliberately explicit. Columns owned by protocols or external systems are
// absent from the list and are documented in docs/operations/id-normalization.md.
const VALUE_SPECS: ValueSpec[] = [
  {
    kind: 'user',
    table: 'user',
    column: 'id',
    length: 22,
    references: [
      ref('account', 'user_id'),
      ref('session', 'user_id'),
      ref('apikey', 'reference_id'),
      ref('deviceCode', 'user_id'),
      ref('member', 'user_id'),
      ref('invitation', 'inviter_id'),
      ref('oauthClient', 'user_id'),
      // Audit history intentionally survives user deletion. Preserve the historical
      // pseudonym even when the original user row no longer exists.
      ref('audit_events', 'user_id', true),
      ref('shares', 'creator_id'),
      ref('share_recipients', 'recipient_user_id'),
      ref('notifications', 'user_id'),
      ref('site_invitations', 'invited_by'),
      ref('site_invitations', 'accepted_by'),
      ref('site_invitations', 'revoked_by'),
      ref('invite_codes', 'created_by'),
      ref('invite_codes', 'used_by'),
      ref('team_invite_links', 'inviter_id'),
      ref('announcements', 'created_by'),
      ref('background_jobs', 'user_id'),
      // Completed task history can outlive its creator.
      ref('download_tasks', 'created_by_user_id', true),
      ref('downloaders', 'created_by'),
    ],
    mappingSources: [
      ref('audit_events', 'user_id'),
      { ...ref('audit_events', 'actor_ref'), predicate: "actor_type = 'user'" },
      ref('apikey', 'reference_id'),
      ref('download_tasks', 'created_by_user_id'),
    ],
  },
  {
    kind: 'organization',
    table: 'organization',
    column: 'id',
    length: 22,
    references: [
      ref('member', 'organization_id'),
      ref('invitation', 'organization_id'),
      ref('session', 'active_organization_id'),
      ref('matters', 'org_id'),
      ref('shares', 'org_id'),
      ref('audit_events', 'org_id', true),
      ref('org_quotas', 'org_id'),
      ref('org_quota_entitlements', 'org_id'),
      ref('storages', 'org_id'),
      ref('notifications', 'org_id'),
      ref('team_invite_links', 'organization_id'),
      ref('background_jobs', 'org_id'),
      ref('download_tasks', 'org_id'),
      ref('object_upload_sessions', 'org_id'),
      ref('remote_download_usage_reports', 'org_id', true),
      ref('cloud_traffic_reports', 'org_id', true),
      ref('storage_usage_ledger', 'org_id', true),
      ref('storage_usage_breakdowns', 'org_id', true),
      ref('image_hosting_configs', 'org_id'),
      ref('image_hostings', 'org_id'),
      ref('x402_capacity_purchase_intents', 'org_id'),
      ref('stats_rollups_hourly', 'org_id', true),
      ref('webdav_dead_properties', 'org_id'),
      ref('webdav_locks', 'org_id'),
    ],
  },
  {
    kind: 'matter',
    table: 'matters',
    column: 'id',
    length: 22,
    references: [
      ref('shares', 'matter_id'),
      ref('object_upload_sessions', 'object_id', true),
      ref('download_tasks', 'result_object_id', true),
    ],
  },
  {
    kind: 'storage',
    table: 'storages',
    column: 'id',
    length: 22,
    references: [
      ref('matters', 'storage_id'),
      ref('object_upload_sessions', 'storage_id'),
      ref('storage_usage_ledger', 'storage_id', true),
      ref('image_hostings', 'storage_id'),
      ref('cloud_traffic_reports', 'storage_id', true),
    ],
  },
  {
    kind: 'share',
    table: 'shares',
    column: 'id',
    length: 22,
    references: [ref('share_recipients', 'share_id')],
  },
  { kind: 'image', table: 'image_hostings', column: 'id', length: 13 },
  {
    kind: 'background_job',
    table: 'background_jobs',
    column: 'id',
    length: 22,
    references: [ref('background_jobs', 'retried_from_job_id')],
  },
  {
    kind: 'downloader',
    table: 'downloaders',
    column: 'id',
    length: 22,
    references: [
      ref('download_tasks', 'assigned_downloader_id'),
      ref('remote_download_usage_reports', 'downloader_id'),
    ],
  },
  {
    kind: 'download_task',
    table: 'download_tasks',
    column: 'id',
    length: 22,
    references: [ref('remote_download_usage_reports', 'task_id', true)],
  },
  ...[
    'account',
    'apikey',
    'deviceCode',
    'audit_events',
    'member',
    'invitation',
    'oauthClient',
    'oauthResource',
    'oauthClientResource',
    'announcements',
    'cloud_traffic_reports',
    'invite_codes',
    'license_bindings',
    'notifications',
    'object_upload_sessions',
    'org_quota_entitlements',
    'org_quotas',
    'remote_download_usage_reports',
    'share_recipients',
    'site_invitations',
    'storage_usage_ledger',
    'team_invite_links',
    'webdav_dead_properties',
    'webdav_locks',
    'webhook_events',
    'x402_capacity_purchase_intents',
  ].map(
    (table): ValueSpec => ({
      kind: table,
      table,
      column: 'id',
      length: 22,
    }),
  ),
  { kind: 'matter_alias', table: 'matters', column: 'alias', length: 11 },
  { kind: 'share_token', table: 'shares', column: 'token', length: 12, rotateAll: true },
  { kind: 'image_token', table: 'image_hostings', column: 'token', length: 12, rotateAll: true },
  { kind: 'site_invite_token', table: 'site_invitations', column: 'token', length: 33, rotateAll: true },
  { kind: 'team_invite_token', table: 'team_invite_links', column: 'token', length: 32, rotateAll: true },
  { kind: 'invite_code', table: 'invite_codes', column: 'code', length: 10, rotateAll: true },
  {
    kind: 'image_verification_token',
    table: 'image_hosting_configs',
    column: 'verification_token',
    length: 33,
    rotateAll: true,
  },
]

const INVALIDATE_TABLES = [
  'session',
  'verification',
  'downloader_bootstrap_credentials',
  'oauthAccessToken',
  'oauthRefreshToken',
  'oauthPushedAuthorizationRequest',
  'oauthClientAssertion',
  'oauthConsent',
  'jwks',
] as const

const VALIDATE_ONLY_COLUMNS = [
  ref('session', 'id'),
  ref('session', 'token'),
  ref('verification', 'id'),
  ref('downloader_bootstrap_credentials', 'id'),
  ref('oauthAccessToken', 'id'),
  ref('oauthRefreshToken', 'id'),
  ref('oauthPushedAuthorizationRequest', 'id'),
  ref('oauthClientAssertion', 'id'),
  ref('oauthConsent', 'id'),
] as const

const JSON_COLUMNS = [
  ref('apikey', 'metadata'),
  ref('audit_events', 'metadata'),
  ref('notifications', 'metadata'),
  ref('background_jobs', 'metadata'),
  ref('background_jobs', 'result_metadata'),
  ref('download_tasks', 'events'),
  ref('org_quota_entitlements', 'metadata'),
  ref('resource_changes', 'metadata'),
  ref('stats_rollups_hourly', 'metadata'),
] as const

const REWRITTEN_COLUMNS = [
  ref('audit_events', 'target_id'),
  ref('audit_events', 'actor_ref'),
  ref('audit_events', 'event_key'),
  ref('resource_changes', 'scope_id'),
  ref('resource_changes', 'resource_id'),
  ref('notifications', 'ref_id'),
  ref('storage_usage_ledger', 'resource_id'),
  ref('storage_usage_ledger', 'event_key'),
  ref('cloud_traffic_reports', 'source_id'),
  ref('org_quota_entitlements', 'source_id'),
  ref('object_upload_sessions', 'created_by'),
] as const

const EMPTY_REFERENCE_SENTINELS = new Set([
  'audit_events.org_id',
  'cloud_traffic_reports.org_id',
  'stats_rollups_hourly.org_id',
  'storage_usage_ledger.org_id',
  'storage_usage_ledger.storage_id',
])

const JSON_KEY_KINDS: Record<string, string> = {
  userId: 'user',
  targetUserId: 'user',
  creatorId: 'user',
  createdBy: 'user',
  invitedBy: 'user',
  orgId: 'organization',
  organizationId: 'organization',
  targetOrgId: 'organization',
  teamId: 'organization',
  matterId: 'matter',
  objectId: 'matter',
  parentId: 'matter',
  storageId: 'storage',
  shareId: 'share',
  imageId: 'image',
  imageHostingId: 'image',
  backgroundJobId: 'background_job',
  jobId: 'background_job',
  downloaderId: 'downloader',
  taskId: 'download_task',
  downloadTaskId: 'download_task',
  notificationId: 'notifications',
  entitlementId: 'org_quota_entitlements',
  uploadSessionId: 'object_upload_sessions',
  matterIds: 'matter',
  grantedBy: 'user',
  updatedBy: 'user',
  revokedBy: 'user',
}

const ENTITY_TYPE_KINDS: Record<string, string> = {
  user: 'user',
  organization: 'organization',
  team: 'organization',
  quota: 'organization',
  matter: 'matter',
  object: 'matter',
  file: 'matter',
  folder: 'matter',
  storage: 'storage',
  share: 'share',
  image: 'image',
  image_hosting: 'image',
  background_job: 'background_job',
  downloader: 'downloader',
  download_task: 'download_task',
  notification: 'notifications',
  entitlement: 'org_quota_entitlements',
  upload_session: 'object_upload_sessions',
}

const POLYMORPHIC_REFERENCES = [
  { table: 'audit_events', typeColumn: 'target_type', valueColumn: 'target_id', typeKinds: ENTITY_TYPE_KINDS },
  {
    table: 'audit_events',
    typeColumn: 'actor_type',
    valueColumn: 'actor_ref',
    typeKinds: { user: 'user', api_key: 'apikey', downloader: 'downloader', 'task-upload': 'download_task' },
  },
  {
    table: 'resource_changes',
    typeColumn: 'scope_type',
    valueColumn: 'scope_id',
    typeKinds: { organization: 'organization', user: 'user' },
  },
  {
    table: 'resource_changes',
    typeColumn: 'resource_type',
    valueColumn: 'resource_id',
    typeKinds: ENTITY_TYPE_KINDS,
  },
  {
    table: 'notifications',
    typeColumn: 'ref_type',
    valueColumn: 'ref_id',
    typeKinds: { share: 'share', team: 'organization', background_job: 'background_job' },
  },
  {
    table: 'storage_usage_ledger',
    typeColumn: 'resource_type',
    valueColumn: 'resource_id',
    typeKinds: { matter: 'matter', image_hosting: 'image', storage: 'storage' },
  },
  {
    table: 'cloud_traffic_reports',
    typeColumn: 'source',
    valueColumn: 'source_id',
    typeKinds: {
      object_download: 'matter',
      webdav_download: 'matter',
      direct_share: 'share',
      landing_share: 'share',
      image_hosting: 'image',
      custom_domain_image: 'image',
    },
  },
] as const

function quoteName(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`unsafe_sql_identifier:${value}`)
  return `"${value}"`
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false
  return (db.prepare(`PRAGMA table_info(${quoteName(table)})`).all() as Array<{ name: string }>).some(
    (entry) => entry.name === column,
  )
}

function rowCount(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${quoteName(table)}`).get() as { count: number }).count
}

function primaryKeyColumns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quoteName(table)})`).all() as Array<{ name: string; pk: number }>)
    .filter(({ pk }) => pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map(({ name }) => name)
}

function ensureControlTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MAP_TABLE} (
      kind TEXT NOT NULL,
      old_value TEXT NOT NULL,
      new_value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (kind, old_value),
      UNIQUE (kind, new_value)
    );
    CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

function normalizationCompleted(db: Database.Database): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM ${STATE_TABLE} WHERE key = 'completed_at' AND value != ''`).get())
}

function normalizationValidated(db: Database.Database): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM ${STATE_TABLE} WHERE key = 'validation_version' AND value = ?`).get(VALIDATION_VERSION),
  )
}

function assertExternallyOwnedInstanceIdentityIsSafe(db: Database.Database): void {
  let invalidSystemOption = 0
  if (columnExists(db, 'system_options', 'key') && columnExists(db, 'system_options', 'value')) {
    invalidSystemOption = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM system_options WHERE key = 'instance_id' AND (value = '' OR value GLOB '*[^A-Za-z0-9]*')",
        )
        .get() as { count: number }
    ).count
  }

  let invalidActiveBindings = 0
  if (
    columnExists(db, 'license_bindings', 'instance_id') &&
    columnExists(db, 'license_bindings', 'status')
  ) {
    invalidActiveBindings = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM license_bindings WHERE status = 'active' AND (instance_id = '' OR instance_id GLOB '*[^A-Za-z0-9]*')",
        )
        .get() as { count: number }
    ).count
  }

  const invalid = invalidSystemOption + invalidActiveBindings
  if (invalid > 0) throw new Error(`external_instance_id_reconciliation_required:${invalid}`)
}

function assertSchemaReady(db: Database.Database): void {
  if (tableExists(db, 'audit_events') && !columnExists(db, 'audit_events', 'event_key')) {
    throw new Error('schema_migration_required:0092_audit_event_key')
  }
}

function assertIdentityDerivedImagesAreReconciled(db: Database.Database): void {
  let invalid = 0
  if (columnExists(db, 'user', 'image')) {
    invalid += (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM user
           WHERE (id = '' OR id GLOB '*[^A-Za-z0-9]*')
             AND image IS NOT NULL AND image != ''`,
        )
        .get() as { count: number }
    ).count
  }
  if (columnExists(db, 'organization', 'logo')) {
    invalid += (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM organization
           WHERE (id = '' OR id GLOB '*[^A-Za-z0-9]*')
             AND logo IS NOT NULL AND logo != ''`,
        )
        .get() as { count: number }
    ).count
  }
  if (invalid > 0) throw new Error(`external_identity_image_reconciliation_required:${invalid}`)
}

function assertMaintenanceStateIsDrained(db: Database.Database): void {
  const activeArchiveJobs = columnExists(db, 'background_jobs', 'status')
    ? (
        db
          .prepare("SELECT COUNT(*) AS count FROM background_jobs WHERE status IN ('queued', 'running')")
          .get() as { count: number }
      ).count
    : 0
  const activeUploads = columnExists(db, 'object_upload_sessions', 'status')
    ? (
        db
          .prepare("SELECT COUNT(*) AS count FROM object_upload_sessions WHERE status NOT IN ('completed', 'aborted')")
          .get() as { count: number }
      ).count
    : 0
  const activeTaskUploads = columnExists(db, 'download_tasks', 'status')
    ? (
        db
          .prepare("SELECT COUNT(*) AS count FROM download_tasks WHERE status IN ('assigned', 'downloading', 'uploading')")
          .get() as { count: number }
      ).count
    : 0
  if (activeArchiveJobs + activeUploads + activeTaskUploads > 0) {
    throw new Error(
      `maintenance_state_not_drained:archive_jobs=${activeArchiveJobs},object_upload_sessions=${activeUploads},download_tasks=${activeTaskUploads}`,
    )
  }
}

function rewriteLegacyDownloadTaskCreators(db: Database.Database): number {
  if (
    !columnExists(db, 'download_tasks', 'created_by_user_id') ||
    !columnExists(db, 'apikey', 'id') ||
    !columnExists(db, 'apikey', 'reference_id')
  ) {
    return 0
  }
  const unresolved = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM download_tasks
         WHERE created_by_user_id LIKE 'api-key:%'
           AND NOT EXISTS (
             SELECT 1 FROM apikey WHERE apikey.id = substr(download_tasks.created_by_user_id, 9)
           )`,
      )
      .get() as { count: number }
  ).count
  if (unresolved > 0) throw new Error(`legacy_download_task_creator_unresolved:${unresolved}`)
  return db
    .prepare(
      `UPDATE download_tasks
       SET created_by_user_id = (
         SELECT reference_id FROM apikey WHERE apikey.id = substr(download_tasks.created_by_user_id, 9)
       )
       WHERE created_by_user_id LIKE 'api-key:%'`,
    )
    .run().changes
}

function assertExternalUsageReferencesAreSafe(db: Database.Database): void {
  let invalid = 0
  if (
    columnExists(db, 'org_quota_entitlements', 'source') &&
    columnExists(db, 'org_quota_entitlements', 'org_id')
  ) {
    invalid += (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM org_quota_entitlements WHERE source = 'cloud_order' AND (org_id = '' OR org_id GLOB '*[^A-Za-z0-9]*')",
        )
        .get() as { count: number }
    ).count
  }
  if (
    columnExists(db, 'cloud_traffic_reports', 'status') &&
    columnExists(db, 'cloud_traffic_reports', 'org_id') &&
    columnExists(db, 'cloud_traffic_reports', 'source_id')
  ) {
    invalid += (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM cloud_traffic_reports
           WHERE status IN ('pending', 'failed', 'blocked', 'skipped_unbound', 'dead_letter')
             AND (org_id = '' OR org_id GLOB '*[^A-Za-z0-9]*' OR source_id = '' OR source_id GLOB '*[^A-Za-z0-9]*')`,
        )
        .get() as { count: number }
    ).count
  }
  if (
    columnExists(db, 'cloud_traffic_reports', 'status') &&
    columnExists(db, 'cloud_traffic_reports', 'storage_id')
  ) {
    invalid += (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM cloud_traffic_reports
           WHERE status IN ('pending', 'failed', 'blocked', 'skipped_unbound', 'dead_letter')
             AND storage_id IS NOT NULL
             AND (storage_id = '' OR storage_id GLOB '*[^A-Za-z0-9]*')`,
        )
        .get() as { count: number }
    ).count
  }
  if (
    columnExists(db, 'remote_download_usage_reports', 'status') &&
    columnExists(db, 'remote_download_usage_reports', 'org_id') &&
    columnExists(db, 'remote_download_usage_reports', 'task_id') &&
    columnExists(db, 'remote_download_usage_reports', 'downloader_id')
  ) {
    invalid += (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM remote_download_usage_reports
           WHERE status != 'reported'
             AND (org_id = '' OR org_id GLOB '*[^A-Za-z0-9]*'
               OR task_id = '' OR task_id GLOB '*[^A-Za-z0-9]*'
               OR downloader_id = '' OR downloader_id GLOB '*[^A-Za-z0-9]*')`,
        )
        .get() as { count: number }
    ).count
  }
  if (
    columnExists(db, 'x402_capacity_purchase_intents', 'status') &&
    columnExists(db, 'x402_capacity_purchase_intents', 'org_id')
  ) {
    invalid += (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM x402_capacity_purchase_intents
           WHERE status NOT IN ('delivered', 'failed', 'canceled', 'expired')
             AND (org_id = '' OR org_id GLOB '*[^A-Za-z0-9]*')`,
        )
        .get() as { count: number }
    ).count
  }
  if (invalid > 0) throw new Error(`external_usage_reconciliation_required:${invalid}`)
}

function assertExternallyBoundOrganizationsAreSafe(db: Database.Database): void {
  if (!columnExists(db, 'license_bindings', 'status') || !columnExists(db, 'organization', 'id')) return
  const activeBindings = (
    db.prepare("SELECT COUNT(*) AS count FROM license_bindings WHERE status = 'active'").get() as { count: number }
  ).count
  if (activeBindings === 0) return
  const organizationsToRemap = (
    db
      .prepare("SELECT COUNT(*) AS count FROM organization WHERE id = '' OR id GLOB '*[^A-Za-z0-9]*'")
      .get() as { count: number }
  ).count
  if (organizationsToRemap > 0) {
    throw new Error(`external_organization_id_reconciliation_required:${organizationsToRemap}`)
  }
}

function collectValues(db: Database.Database, spec: ValueSpec): string[] {
  const historicalPolymorphicSources = POLYMORPHIC_REFERENCES.flatMap(
    ({ table, typeColumn, valueColumn, typeKinds }) =>
      Object.entries(typeKinds).flatMap(([type, kind]) =>
        kind === spec.kind
          ? [
              {
                table,
                column: valueColumn,
                predicate: `${quoteName(typeColumn)} = ${sqlLiteral(type)} AND ${quoteName(valueColumn)} != ''`,
              },
            ]
          : [],
      ),
  )
  const sources: MappingSource[] = [
    { table: spec.table, column: spec.column },
    ...(spec.references ?? []).filter((reference) => reference.allowDangling),
    ...(spec.mappingSources ?? []),
    ...historicalPolymorphicSources,
  ]
  const values = new Set<string>()
  for (const source of sources) {
    if (!columnExists(db, source.table, source.column)) continue
    const table = quoteName(source.table)
    const column = quoteName(source.column)
    const allowEmpty = EMPTY_REFERENCE_SENTINELS.has(`${source.table}.${source.column}`)
    const rotationPredicate =
      spec.rotateAll && source.table === spec.table && source.column === spec.column
        ? `${column} IS NOT NULL AND ${column} != ''`
        : allowEmpty
          ? `${column} GLOB '*[^A-Za-z0-9]*'`
          : `${column} GLOB '*[^A-Za-z0-9]*' OR ${column} = ''`
    const sourcePredicate = source.predicate ? `AND (${source.predicate})` : ''
    const rows = db
      .prepare(
        `SELECT DISTINCT ${column} AS value FROM ${table}
         WHERE (${rotationPredicate}) ${sourcePredicate}
           AND NOT EXISTS (
             SELECT 1 FROM ${MAP_TABLE} map
             WHERE map.kind = ? AND map.new_value = ${table}.${column}
           )`,
      )
      .all(spec.kind) as Array<{ value: string | null }>
    for (const { value } of rows) if (value !== null) values.add(value)
  }
  for (const value of collectJsonMappingValues(db, spec)) values.add(value)
  return [...values]
}

function addMappings(db: Database.Database, spec: ValueSpec, values: string[], now: number): void {
  const insert = db.prepare(
    `INSERT INTO ${MAP_TABLE} (kind, old_value, new_value, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(kind, old_value) DO NOTHING`,
  )
  const used = new Set<string>(
    (db.prepare(`SELECT new_value AS value FROM ${MAP_TABLE}`).all() as Array<{ value: string }>).map(({ value }) => value),
  )
  for (const oldValue of values) {
    let newValue = generateMappedValue(spec)
    while (used.has(newValue)) newValue = generateMappedValue(spec)
    used.add(newValue)
    insert.run(spec.kind, oldValue, newValue, now)
  }
}

function generateMappedValue(spec: ValueSpec): string {
  if (spec.kind === 'share_token') return generateShareToken()
  if (spec.kind === 'image_token') return generateImageToken()
  return spec.column === 'id' ? generateId(spec.length) : generateToken(spec.length)
}

function invalidValuePredicate(spec: ValueSpec, column: string, allowEmpty: boolean): string {
  const invalid =
    spec.kind === 'share_token'
      ? `length(${column}) != 12 OR substr(${column}, 1, 1) != 's' OR substr(${column}, 2) GLOB '*[^A-Za-z0-9]*'`
      : spec.kind === 'image_token'
        ? `length(${column}) != 12 OR substr(${column}, 1, 1) != 'i' OR substr(${column}, 2) GLOB '*[^A-Za-z0-9]*'`
        : `${column} = '' OR ${column} GLOB '*[^A-Za-z0-9]*'`
  return allowEmpty ? `${column} != '' AND (${invalid})` : invalid
}

function updateColumn(db: Database.Database, spec: ValueSpec, target: Reference): number {
  if (!columnExists(db, target.table, target.column)) return 0
  const table = quoteName(target.table)
  const column = quoteName(target.column)
  return db
    .prepare(
      `UPDATE ${table}
       SET ${column} = (SELECT new_value FROM ${MAP_TABLE} map WHERE map.kind = ? AND map.old_value = ${table}.${column})
       WHERE EXISTS (SELECT 1 FROM ${MAP_TABLE} map WHERE map.kind = ? AND map.old_value = ${table}.${column})`,
    )
    .run(spec.kind, spec.kind).changes
}

function mappingsByKind(db: Database.Database): Map<string, Map<string, string>> {
  const rows = db.prepare(`SELECT kind, old_value, new_value FROM ${MAP_TABLE}`).all() as Array<{
    kind: string
    old_value: string
    new_value: string
  }>
  const result = new Map<string, Map<string, string>>()
  for (const row of rows) {
    const kindMappings = result.get(row.kind) ?? new Map<string, string>()
    kindMappings.set(row.old_value, row.new_value)
    result.set(row.kind, kindMappings)
  }
  return result
}

function rewriteJsonValue(
  value: unknown,
  byKind: Map<string, Map<string, string>>,
  source: Reference,
  key?: string,
): unknown {
  if (Array.isArray(value)) return value.map((entry) => rewriteJsonValue(entry, byKind, source, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        rewriteJsonValue(child, byKind, source, childKey),
      ]),
    )
  }
  if (typeof value !== 'string' || !key) return value
  if (source.table === 'download_tasks' && source.column === 'events' && key === 'id' && value.startsWith('initial:')) {
    return replaceSegments(value, byKind.get('download_task'))
  }
  const kind = jsonReferenceKind(source, key)
  return (kind ? byKind.get(kind)?.get(value) : undefined) ?? value
}

function jsonReferenceKind(source: Reference, key: string): string | undefined {
  const contextualKind =
    source.table === 'notifications' && source.column === 'metadata' && key === 'token'
      ? 'share_token'
      : source.table === 'audit_events' && source.column === 'metadata' && key === 'sessionId'
        ? 'object_upload_sessions'
        : source.table === 'audit_events' && source.column === 'metadata' && key === 'sourceId'
        ? 'matter'
          : undefined
  return contextualKind ?? JSON_KEY_KINDS[key]
}

function mappedValueIsValid(spec: ValueSpec, value: string): boolean {
  if (spec.kind === 'share_token') return /^s[A-Za-z0-9]{11}$/.test(value)
  if (spec.kind === 'image_token') return /^i[A-Za-z0-9]{11}$/.test(value)
  return BASE62_PATTERN.test(value)
}

function collectJsonValuesForKind(
  value: unknown,
  source: Reference,
  spec: ValueSpec,
  result: Set<string>,
  key?: string,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectJsonValuesForKind(entry, source, spec, result, key)
    return
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) {
      collectJsonValuesForKind(child, source, spec, result, childKey)
    }
    return
  }
  if (typeof value !== 'string' || !key) return
  if (source.table === 'download_tasks' && source.column === 'events' && key === 'id' && value.startsWith('initial:')) {
    const taskId = value.slice('initial:'.length)
    if (spec.kind === 'download_task' && !mappedValueIsValid(spec, taskId)) result.add(taskId)
    return
  }
  if (jsonReferenceKind(source, key) === spec.kind && !mappedValueIsValid(spec, value)) result.add(value)
}

function collectJsonMappingValues(db: Database.Database, spec: ValueSpec): Set<string> {
  const result = new Set<string>()
  for (const source of JSON_COLUMNS) {
    if (!columnExists(db, source.table, source.column)) continue
    const rows = db
      .prepare(
        `SELECT ${quoteName(source.column)} AS value FROM ${quoteName(source.table)}
         WHERE ${quoteName(source.column)} IS NOT NULL`,
    )
      .all() as Array<{ value: string }>
    for (const row of rows) {
      let parsed: unknown
      try {
        parsed = JSON.parse(row.value)
      } catch {
        throw new Error(`invalid_json:${source.table}.${source.column}`)
      }
      collectJsonValuesForKind(parsed, source, spec, result)
    }
  }
  return result
}

function jsonReferenceKeys(source: Reference): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [key, kind] of Object.entries(JSON_KEY_KINDS)) {
    const keys = result.get(kind) ?? []
    keys.push(key)
    result.set(kind, keys)
  }
  for (const key of ['token', 'sessionId', 'sourceId']) {
    const kind = jsonReferenceKind(source, key)
    if (!kind) continue
    const keys = result.get(kind) ?? []
    keys.push(key)
    result.set(kind, keys)
  }
  return result
}

function rewriteJsonDocuments(db: Database.Database): number {
  const byKind = mappingsByKind(db)
  let changes = 0
  for (const { table, column } of JSON_COLUMNS) {
    if (!columnExists(db, table, column)) continue
    const rows = db
      .prepare(
        `SELECT rowid AS migration_rowid, ${quoteName(column)} AS value
         FROM ${quoteName(table)} WHERE ${quoteName(column)} IS NOT NULL`,
      )
      .all() as Array<{ migration_rowid: number; value: string }>
    const update = db.prepare(`UPDATE ${quoteName(table)} SET ${quoteName(column)} = ? WHERE rowid = ?`)
    for (const row of rows) {
      let parsed: unknown
      try {
        parsed = JSON.parse(row.value)
      } catch {
        throw new Error(`invalid_json:${table}.${column}:rowid=${row.migration_rowid}`)
      }
      const next = JSON.stringify(rewriteJsonValue(parsed, byKind, { table, column }))
      if (next !== row.value) {
        update.run(next, row.migration_rowid)
        changes += 1
      }
    }
  }
  return changes
}

function rewritePolymorphicReferences(db: Database.Database): number {
  const byKind = mappingsByKind(db)
  let changes = 0
  for (const { table, typeColumn, valueColumn, typeKinds } of POLYMORPHIC_REFERENCES) {
    if (!columnExists(db, table, typeColumn) || !columnExists(db, table, valueColumn)) continue
    const rows = db
      .prepare(
        `SELECT rowid AS migration_rowid, ${quoteName(typeColumn)} AS type, ${quoteName(valueColumn)} AS value
         FROM ${quoteName(table)} WHERE ${quoteName(valueColumn)} IS NOT NULL`,
      )
      .all() as Array<{ migration_rowid: number; type: string; value: string }>
    const update = db.prepare(`UPDATE ${quoteName(table)} SET ${quoteName(valueColumn)} = ? WHERE rowid = ?`)
    for (const row of rows) {
      const kind = (typeKinds as Record<string, string>)[row.type]
      const next = kind ? byKind.get(kind)?.get(row.value) : undefined
      if (next && next !== row.value) {
        update.run(next, row.migration_rowid)
        changes += 1
      }
    }
  }

  return changes
}

function replaceSegments(value: string, mappings: Map<string, string> | undefined): string {
  if (!mappings) return value
  return value
    .split(':')
    .map((segment) => mappings.get(segment) ?? segment)
    .join(':')
}

function rewriteStructuredKeys(db: Database.Database): number {
  const byKind = mappingsByKind(db)
  let changes = 0

  if (columnExists(db, 'audit_events', 'event_key') && columnExists(db, 'audit_events', 'target_type')) {
    const rows = db
      .prepare(
        'SELECT rowid AS migration_rowid, target_type AS type, event_key AS value FROM audit_events WHERE event_key IS NOT NULL',
      )
      .all() as Array<{ migration_rowid: number; type: string; value: string }>
    const update = db.prepare('UPDATE audit_events SET event_key = ? WHERE rowid = ?')
    for (const row of rows) {
      const kind = ENTITY_TYPE_KINDS[row.type]
      const next = replaceSegments(row.value, kind ? byKind.get(kind) : undefined)
      if (next !== row.value) {
        update.run(next, row.migration_rowid)
        changes += 1
      }
    }
  }

  if (columnExists(db, 'storage_usage_ledger', 'event_key')) {
    const rows = db
      .prepare(
        'SELECT rowid AS migration_rowid, event_key AS value FROM storage_usage_ledger WHERE event_key IS NOT NULL',
      )
      .all() as Array<{ migration_rowid: number; value: string }>
    const update = db.prepare('UPDATE storage_usage_ledger SET event_key = ? WHERE rowid = ?')
    for (const row of rows) {
      let next = row.value
      if (next.startsWith('opening:') || next.startsWith('integrity-opening:')) {
        next = replaceSegments(replaceSegments(next, byKind.get('organization')), byKind.get('storage'))
      } else if (next.startsWith('matter:')) next = replaceSegments(next, byKind.get('matter'))
      else if (next.startsWith('image:')) next = replaceSegments(next, byKind.get('image'))
      if (next !== row.value) {
        update.run(next, row.migration_rowid)
        changes += 1
      }
    }
  }

  if (columnExists(db, 'org_quota_entitlements', 'source_id')) {
    const orgMappings = byKind.get('organization')
    const rows = db
      .prepare(
        "SELECT rowid AS migration_rowid, source_id AS value FROM org_quota_entitlements WHERE source = 'free_plan'",
      )
      .all() as Array<{ migration_rowid: number; value: string }>
    const update = db.prepare('UPDATE org_quota_entitlements SET source_id = ? WHERE rowid = ?')
    for (const row of rows) {
      if (!row.value.startsWith('free_plan:')) continue
      const next = replaceSegments(row.value, orgMappings)
      if (next !== row.value) {
        update.run(next, row.migration_rowid)
        changes += 1
      }
    }
  }

  if (columnExists(db, 'object_upload_sessions', 'created_by')) {
    const rows = db
      .prepare(
        'SELECT rowid AS migration_rowid, created_by AS value FROM object_upload_sessions WHERE created_by IS NOT NULL',
      )
      .all() as Array<{ migration_rowid: number; value: string }>
    const update = db.prepare('UPDATE object_upload_sessions SET created_by = ? WHERE rowid = ?')
    for (const row of rows) {
      const next = row.value.startsWith('downloader:')
        ? replaceSegments(row.value, byKind.get('downloader'))
        : byKind.get('user')?.get(row.value) ?? row.value
      if (next !== row.value) {
        update.run(next, row.migration_rowid)
        changes += 1
      }
    }
  }
  return changes
}

function invalidateDynamicOAuthClients(db: Database.Database, invalidated: Record<string, number>): void {
  if (!columnExists(db, 'oauthClientRegistration', 'client_id') || !columnExists(db, 'oauthClient', 'client_id')) {
    return
  }

  const dynamicClientPredicate =
    'EXISTS (SELECT 1 FROM oauthClientRegistration registration WHERE registration.client_id = oauthClient.client_id)'
  const dynamicClients = (
    db.prepare(`SELECT COUNT(*) AS count FROM oauthClient WHERE ${dynamicClientPredicate}`).get() as { count: number }
  ).count
  const registrations = rowCount(db, 'oauthClientRegistration')
  let clientResources = 0
  if (columnExists(db, 'oauthClientResource', 'client_id')) {
    clientResources = (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM oauthClientResource WHERE client_id IN (SELECT client_id FROM oauthClientRegistration)',
        )
        .get() as { count: number }
    ).count
    db.exec('DELETE FROM oauthClientResource WHERE client_id IN (SELECT client_id FROM oauthClientRegistration)')
    invalidated.oauthClientResource = clientResources
  }

  // Delete the client while the registration rows still identify the exact dynamic subset.
  // With foreign keys enabled this also cascades the registration; with them disabled the
  // explicit registration delete below produces the same final state.
  db.exec(`DELETE FROM oauthClient WHERE ${dynamicClientPredicate}`)
  db.exec('DELETE FROM oauthClientRegistration')
  invalidated.oauthClient = dynamicClients
  invalidated.oauthClientRegistration = registrations
}

function invalidateDownloaderCredentials(db: Database.Database): number {
  if (
    !columnExists(db, 'downloaders', 'id') ||
    !columnExists(db, 'downloaders', 'token_hash') ||
    !columnExists(db, 'downloaders', 'token_jti') ||
    !columnExists(db, 'downloaders', 'enabled')
  ) {
    return 0
  }
  const rows = db.prepare('SELECT id FROM downloaders').all() as Array<{ id: string }>
  const update = db.prepare("UPDATE downloaders SET token_hash = '', token_jti = ?, enabled = 0 WHERE id = ?")
  for (const row of rows) update.run(generateToken(32), row.id)
  return rows.length
}

function targetSpec(kind: string): ValueSpec | undefined {
  return VALUE_SPECS.find((spec) => spec.kind === kind)
}

function assertDirectReferencesResolve(db: Database.Database): void {
  for (const spec of VALUE_SPECS) {
    if (!columnExists(db, spec.table, spec.column)) continue
    for (const reference of spec.references ?? []) {
      if (!columnExists(db, reference.table, reference.column)) continue
      if (reference.allowDangling) continue
      const referenceColumn = quoteName(reference.column)
      const invalid = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM ${quoteName(reference.table)} source
             WHERE source.${referenceColumn} IS NOT NULL AND source.${referenceColumn} != ''
               AND NOT EXISTS (
                 SELECT 1 FROM ${quoteName(spec.table)} target
                 WHERE target.${quoteName(spec.column)} = source.${referenceColumn}
               )`,
          )
          .get() as { count: number }
      ).count
      if (invalid > 0) {
        throw new Error(`dangling_reference:${reference.table}.${reference.column}->${spec.table}.${spec.column}:${invalid}`)
      }
    }
  }
}

function polymorphicException(table: string, valueColumn: string): string {
  if (table === 'cloud_traffic_reports') return "AND source.status != 'ledger_opening'"
  if (table === 'resource_changes' && valueColumn === 'resource_id') {
    return "AND NOT (source.resource_type = 'notification' AND source.resource_id = '*')"
  }
  return ''
}

function polymorphicAllowsDangling(table: string): boolean {
  return (
    table === 'audit_events' ||
    table === 'resource_changes' ||
    table === 'storage_usage_ledger' ||
    table === 'cloud_traffic_reports'
  )
}

function assertPolymorphicReferencesResolve(db: Database.Database): void {
  for (const { table, typeColumn, valueColumn, typeKinds } of POLYMORPHIC_REFERENCES) {
    if (!columnExists(db, table, typeColumn) || !columnExists(db, table, valueColumn)) continue
    for (const [type, kind] of Object.entries(typeKinds)) {
      // Historical audit/change rows can outlive their referenced entity. Their
      // normalized reference is a pseudonym, not a live foreign key.
      if (polymorphicAllowsDangling(table)) continue
      const spec = targetSpec(kind)
      if (!spec || !columnExists(db, spec.table, spec.column)) continue
      const invalid = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM ${quoteName(table)} source
             WHERE source.${quoteName(typeColumn)} = ${sqlLiteral(type)}
               AND source.${quoteName(valueColumn)} IS NOT NULL AND source.${quoteName(valueColumn)} != ''
               ${polymorphicException(table, valueColumn)}
               AND NOT EXISTS (
                 SELECT 1 FROM ${quoteName(spec.table)} target
                 WHERE target.${quoteName(spec.column)} = source.${quoteName(valueColumn)}
               )`,
          )
          .get() as { count: number }
      ).count
      if (invalid > 0) throw new Error(`dangling_polymorphic_reference:${table}.${valueColumn}:${type}:${invalid}`)
    }
  }
}

function referenceValueExists(db: Database.Database, kind: string, value: string): boolean {
  const spec = targetSpec(kind)
  if (!spec || !columnExists(db, spec.table, spec.column)) return true
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM ${quoteName(spec.table)} WHERE ${quoteName(spec.column)} = ? LIMIT 1`,
      )
      .get(value),
  )
}

function countDanglingJsonReferences(
  db: Database.Database,
  value: unknown,
  source: Reference,
  key?: string,
): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + countDanglingJsonReferences(db, entry, source, key), 0)
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce(
      (sum, [childKey, child]) => sum + countDanglingJsonReferences(db, child, source, childKey),
      0,
    )
  }
  if (typeof value !== 'string' || !key) return 0
  if (source.table === 'download_tasks' && source.column === 'events' && key === 'id' && value.startsWith('initial:')) {
    const taskId = value.slice('initial:'.length)
    return referenceValueExists(db, 'download_task', taskId) ? 0 : 1
  }
  const kind = jsonReferenceKind(source, key)
  return !kind || referenceValueExists(db, kind, value) ? 0 : 1
}

function assertJsonReferencesResolve(db: Database.Database): void {
  for (const source of JSON_COLUMNS) {
    if (!columnExists(db, source.table, source.column)) continue
    const rows = db
      .prepare(
        `SELECT ${quoteName(source.column)} AS value FROM ${quoteName(source.table)}
         WHERE ${quoteName(source.column)} IS NOT NULL`,
      )
      .all() as Array<{ value: string }>
    let invalid = 0
    for (const row of rows) invalid += countDanglingJsonReferences(db, JSON.parse(row.value), source)
    if (invalid > 0 && !jsonAllowsDangling(source)) {
      throw new Error(`dangling_json_reference:${source.table}.${source.column}:${invalid}`)
    }
  }
}

function jsonAllowsDangling(source: Reference): boolean {
  return (
    source.table === 'audit_events' ||
    source.table === 'resource_changes' ||
    source.table === 'background_jobs' ||
    source.table === 'stats_rollups_hourly'
  )
}

function assertStructuredReferencesResolve(db: Database.Database): void {
  if (!columnExists(db, 'object_upload_sessions', 'created_by')) return
  const invalid = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM object_upload_sessions source
         WHERE (source.created_by LIKE 'downloader:%' AND NOT EXISTS (
           SELECT 1 FROM downloaders target WHERE target.id = substr(source.created_by, 12)
         )) OR (source.created_by NOT LIKE 'downloader:%' AND NOT EXISTS (
           SELECT 1 FROM user target WHERE target.id = source.created_by
         ))`,
      )
      .get() as { count: number }
  ).count
  if (invalid > 0) throw new Error(`dangling_structured_reference:object_upload_sessions.created_by:${invalid}`)
}

function validate(db: Database.Database, rowCounts: Map<string, number>, invalidated: Record<string, number>): number {
  const foreignKeyFailures = db.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyFailures.length > 0) throw new Error(`foreign_key_check_failed:${foreignKeyFailures.length}`)

  for (const [table, before] of rowCounts) {
    const expected = before - (invalidated[table] ?? 0)
    const after = rowCount(db, table)
    if (after !== expected) throw new Error(`row_count_mismatch:${table}:${before}:${after}:${expected}`)
  }

  const stalePolymorphic = rewritePolymorphicReferences(db)
  const staleJson = rewriteJsonDocuments(db)
  const staleStructured = rewriteStructuredKeys(db)
  if (stalePolymorphic + staleJson + staleStructured > 0) {
    throw new Error(
      `stale_embedded_reference:polymorphic=${stalePolymorphic},json=${staleJson},structured=${staleStructured}`,
    )
  }
  for (const spec of VALUE_SPECS) {
    for (const [target, allowEmpty] of [
      [{ table: spec.table, column: spec.column }, false] as const,
      ...(spec.references ?? []).map(
        (reference) => [reference, EMPTY_REFERENCE_SENTINELS.has(`${reference.table}.${reference.column}`)] as const,
      ),
    ]) {
      if (!columnExists(db, target.table, target.column)) continue
      const column = quoteName(target.column)
      const invalid = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM ${quoteName(target.table)}
             WHERE ${column} IS NOT NULL
               AND (${invalidValuePredicate(spec, column, allowEmpty)})`,
          )
          .get() as { count: number }
      ).count
      if (invalid > 0) throw new Error(`invalid_value_remaining:${target.table}.${target.column}:${invalid}`)
    }
  }

  for (const { table, column } of VALIDATE_ONLY_COLUMNS) {
    if (!columnExists(db, table, column)) continue
    const invalid = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM ${quoteName(table)}
           WHERE ${quoteName(column)} IS NOT NULL
             AND (${quoteName(column)} = '' OR ${quoteName(column)} GLOB '*[^A-Za-z0-9]*')`,
        )
        .get() as { count: number }
    ).count
    if (invalid > 0) throw new Error(`invalid_value_remaining:${table}.${column}:${invalid}`)
  }

  for (const { table, typeColumn, valueColumn, typeKinds } of POLYMORPHIC_REFERENCES) {
    if (!columnExists(db, table, typeColumn) || !columnExists(db, table, valueColumn)) continue
    const knownTypes = Object.keys(typeKinds).map(sqlLiteral).join(', ')
    const invalid = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM ${quoteName(table)}
           WHERE ${quoteName(typeColumn)} IN (${knownTypes})
             ${table === 'cloud_traffic_reports' ? "AND status != 'ledger_opening'" : ''}
             ${table === 'resource_changes' && valueColumn === 'resource_id' ? "AND NOT (resource_type = 'notification' AND resource_id = '*')" : ''}
             AND ${quoteName(valueColumn)} IS NOT NULL AND ${quoteName(valueColumn)} != ''
             AND ${quoteName(valueColumn)} GLOB '*[^A-Za-z0-9]*'`,
        )
        .get() as { count: number }
    ).count
    if (invalid > 0) throw new Error(`invalid_polymorphic_reference:${table}.${valueColumn}:${invalid}`)
  }

  if (columnExists(db, 'object_upload_sessions', 'created_by')) {
    const invalid = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM object_upload_sessions
           WHERE created_by = '' OR (
             created_by GLOB '*[^A-Za-z0-9]*'
             AND NOT (created_by LIKE 'downloader:%'
               AND substr(created_by, 12) != ''
               AND substr(created_by, 12) NOT GLOB '*[^A-Za-z0-9]*')
           )`,
        )
        .get() as { count: number }
    ).count
    if (invalid > 0) throw new Error(`invalid_structured_reference:object_upload_sessions.created_by:${invalid}`)
  }

  for (const spec of VALUE_SPECS) {
    const invalidJsonValues = collectJsonMappingValues(db, spec).size
    if (invalidJsonValues > 0) throw new Error(`invalid_json_reference:${spec.kind}:${invalidJsonValues}`)
  }
  assertDirectReferencesResolve(db)
  assertPolymorphicReferencesResolve(db)
  assertJsonReferencesResolve(db)
  assertStructuredReferencesResolve(db)

  return rowCounts.size
}

export function normalizeDatabase(db: Database.Database, apply: boolean): NormalizationSummary {
  const mappings: Record<string, number> = {}
  const invalidated: Record<string, number> = {}
  const credentialsInvalidated: Record<string, number> = {}
  let jsonDocumentsUpdated = 0
  let polymorphicReferencesUpdated = 0
  let structuredKeysUpdated = 0
  let rowCountsVerified = 0

  const run = db.transaction(() => {
    assertSchemaReady(db)
    ensureControlTables(db)
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_zpan_id_normalization_%' AND name NOT GLOB '_cf_*'",
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name)
    const rowCounts = new Map(tables.map((table) => [table, rowCount(db, table)]))

    if (normalizationCompleted(db)) {
      if (!normalizationValidated(db)) throw new Error('id_normalization_validation_marker_missing')
      for (const spec of VALUE_SPECS) mappings[spec.kind] = 0
      rowCountsVerified = validate(db, rowCounts, invalidated)
      return
    }

    assertExternallyOwnedInstanceIdentityIsSafe(db)
    assertExternallyBoundOrganizationsAreSafe(db)
    assertExternalUsageReferencesAreSafe(db)
    assertIdentityDerivedImagesAreReconciled(db)
    assertMaintenanceStateIsDrained(db)

    structuredKeysUpdated += rewriteLegacyDownloadTaskCreators(db)

    if (columnExists(db, 'audit_events', 'event_key')) {
      db.exec(
        "UPDATE audit_events SET event_key = id WHERE event_key IS NULL AND (id GLOB '*[^A-Za-z0-9]*' OR id = '')",
      )
    }

    const now = Date.now()
    for (const spec of VALUE_SPECS) {
      const values = collectValues(db, spec)
      mappings[spec.kind] = values.length
      addMappings(db, spec, values, now)
    }
    for (const spec of VALUE_SPECS) {
      updateColumn(db, spec, { table: spec.table, column: spec.column })
      for (const target of spec.references ?? []) updateColumn(db, spec, target)
    }

    polymorphicReferencesUpdated = rewritePolymorphicReferences(db)
    jsonDocumentsUpdated = rewriteJsonDocuments(db)
    structuredKeysUpdated = rewriteStructuredKeys(db)
    credentialsInvalidated.downloaders = invalidateDownloaderCredentials(db)

    for (const table of INVALIDATE_TABLES) {
      if (!tableExists(db, table)) continue
      const count = rowCount(db, table)
      invalidated[table] = count
      db.exec(`DELETE FROM ${quoteName(table)}`)
    }
    invalidateDynamicOAuthClients(db, invalidated)

    rowCountsVerified = validate(db, rowCounts, invalidated)
    db.prepare(`INSERT INTO ${STATE_TABLE} (key, value) VALUES ('completed_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(now))
    db.prepare(`INSERT INTO ${STATE_TABLE} (key, value) VALUES ('validation_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(VALIDATION_VERSION)
    if (!apply) throw new DryRunRollback()
  })

  try {
    run()
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
  return {
    apply,
    mappings,
    invalidated,
    credentialsInvalidated,
    jsonDocumentsUpdated,
    polymorphicReferencesUpdated,
    structuredKeysUpdated,
    rowCountsVerified,
  }
}

class DryRunRollback extends Error {}

function sqlLiteral(value: string | number): string {
  return typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`
}

function chunkSqlFragments(fragments: string[]): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let bytes = 0
  for (const fragment of fragments) {
    const fragmentBytes = Buffer.byteLength(fragment) + (current.length > 0 ? 2 : 0)
    if (fragmentBytes > D1_STATEMENT_BUDGET_BYTES) throw new Error('d1_plan_literal_too_large')
    if (current.length > 0 && bytes + fragmentBytes > D1_STATEMENT_BUDGET_BYTES) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(fragment)
    bytes += fragmentBytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function buildD1ApplySql(db: Database.Database): string {
  assertSchemaReady(db)
  if (!normalizationCompleted(db) || !normalizationValidated(db)) {
    throw new Error('d1_plan_requires_validated_normalization')
  }
  const normalizationPending =
    `NOT EXISTS (SELECT 1 FROM ${STATE_TABLE} WHERE key = 'completed_at' AND value != '')`
  const statements = [
    '-- Sensitive migration artifact. Keep mode 0600 and delete it after the approved maintenance window.',
    '-- D1 rejects explicit BEGIN/COMMIT. Wrangler executes this file as a batch; persistent mappings make retries safe.',
    'PRAGMA defer_foreign_keys = ON;',
    `CREATE TABLE IF NOT EXISTS ${MAP_TABLE} (
      kind TEXT NOT NULL,
      old_value TEXT NOT NULL,
      new_value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (kind, old_value),
      UNIQUE (kind, new_value)
    );`,
    `CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    `CREATE TABLE IF NOT EXISTS ${EXACT_VALUE_TABLE} (
      target_table TEXT NOT NULL,
      target_column TEXT NOT NULL,
      key_json TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (target_table, target_column, key_json)
    );`,
    `CREATE TABLE IF NOT EXISTS _zpan_id_normalization_assertions (
      check_name TEXT PRIMARY KEY,
      violations INTEGER NOT NULL CHECK (violations = 0)
    );`,
  ]
  const addAssertion = (name: string, countSql: string): void => {
    statements.push(
      `INSERT INTO _zpan_id_normalization_assertions (check_name, violations)
       SELECT ${sqlLiteral(name)}, (${countSql}) WHERE ${normalizationPending}
       ON CONFLICT(check_name) DO UPDATE SET violations = excluded.violations;`,
    )
  }
  const deferredAssertions: Array<{ name: string; countSql: string }> = []
  statements.push(
    `DELETE FROM _zpan_id_normalization_assertions
     WHERE check_name = 'preexisting-completion-marker'
       AND EXISTS (
         SELECT 1 FROM ${STATE_TABLE} WHERE key = 'completed_at' AND value != ''
           AND NOT EXISTS (SELECT 1 FROM ${STATE_TABLE} WHERE key = 'validation_version' AND value = ${sqlLiteral(VALIDATION_VERSION)})
       );`,
    `INSERT INTO _zpan_id_normalization_assertions (check_name, violations)
     SELECT 'preexisting-completion-marker', 1
     WHERE EXISTS (
       SELECT 1 FROM ${STATE_TABLE} WHERE key = 'completed_at' AND value != ''
         AND NOT EXISTS (SELECT 1 FROM ${STATE_TABLE} WHERE key = 'validation_version' AND value = ${sqlLiteral(VALIDATION_VERSION)})
     );`,
  )

  const mapRows = db.prepare(`SELECT kind, old_value, new_value, created_at FROM ${MAP_TABLE}`).all() as Array<{
    kind: string
    old_value: string
    new_value: string
    created_at: number
  }>
  const mapValues = mapRows.map(
    (row) => `(${sqlLiteral(row.kind)}, ${sqlLiteral(row.old_value)}, ${sqlLiteral(row.new_value)}, ${row.created_at})`,
  )
  for (const chunk of chunkSqlFragments(mapValues)) {
    statements.push(
      `INSERT INTO ${MAP_TABLE} (kind, old_value, new_value, created_at) VALUES ${chunk.join(', ')} ON CONFLICT(kind, old_value) DO NOTHING;`,
    )
  }
  addAssertion('reviewed-mapping-count', `SELECT ABS(COUNT(*) - ${mapRows.length}) FROM ${MAP_TABLE}`)
  for (const [index, chunk] of chunkSqlFragments(mapValues).entries()) {
    addAssertion(
      `reviewed-mapping:${index + 1}`,
      `WITH reviewed(kind, old_value, new_value, created_at) AS (VALUES ${chunk.join(', ')})
       SELECT COUNT(*) FROM reviewed expected LEFT JOIN ${MAP_TABLE} actual
       ON actual.kind = expected.kind AND actual.old_value = expected.old_value
       WHERE actual.new_value IS NOT expected.new_value OR actual.created_at IS NOT expected.created_at`,
      )
  }

  if (
    columnExists(db, 'download_tasks', 'created_by_user_id') &&
    columnExists(db, 'apikey', 'id') &&
    columnExists(db, 'apikey', 'reference_id')
  ) {
    statements.push(
      `UPDATE download_tasks
       SET created_by_user_id = (
         SELECT reference_id FROM apikey WHERE apikey.id = substr(download_tasks.created_by_user_id, 9)
       )
       WHERE ${normalizationPending} AND created_by_user_id LIKE 'api-key:%'
         AND EXISTS (
           SELECT 1 FROM apikey WHERE apikey.id = substr(download_tasks.created_by_user_id, 9)
         );`,
    )
    deferredAssertions.push({
      name: 'legacy-download-task-creators',
      countSql: "SELECT COUNT(*) FROM download_tasks WHERE created_by_user_id LIKE 'api-key:%'",
    })
  }

  if (columnExists(db, 'audit_events', 'event_key')) {
    statements.push(
      `UPDATE audit_events SET event_key = id WHERE ${normalizationPending} AND event_key IS NULL AND (id GLOB '*[^A-Za-z0-9]*' OR id = '');`,
    )
  }
  for (const spec of VALUE_SPECS) {
    for (const target of [{ table: spec.table, column: spec.column }, ...(spec.references ?? [])]) {
      if (!columnExists(db, target.table, target.column)) continue
      const table = quoteName(target.table)
      const column = quoteName(target.column)
      statements.push(
        `UPDATE ${table} SET ${column} = (SELECT new_value FROM ${MAP_TABLE} map WHERE map.kind = ${sqlLiteral(spec.kind)} AND map.old_value = ${table}.${column}) WHERE ${normalizationPending} AND EXISTS (SELECT 1 FROM ${MAP_TABLE} map WHERE map.kind = ${sqlLiteral(spec.kind)} AND map.old_value = ${table}.${column});`,
      )
      const expectedNewValues = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM ${table} source
             WHERE EXISTS (
               SELECT 1 FROM ${MAP_TABLE} map
               WHERE map.kind = ? AND map.new_value = source.${column}
             )`,
          )
          .get(spec.kind) as { count: number }
      ).count
      deferredAssertions.push({
        name: `direct-mapping:${spec.kind}:${target.table}.${target.column}`,
        countSql: `SELECT
           (SELECT COUNT(*) FROM ${table} source WHERE EXISTS (
             SELECT 1 FROM ${MAP_TABLE} map
             WHERE map.kind = ${sqlLiteral(spec.kind)} AND map.old_value = source.${column}
           ))
           + ABS((SELECT COUNT(*) FROM ${table} source WHERE EXISTS (
             SELECT 1 FROM ${MAP_TABLE} map
             WHERE map.kind = ${sqlLiteral(spec.kind)} AND map.new_value = source.${column}
           )) - ${expectedNewValues})`,
      })
    }
  }

  const newValues = mapRows.map(({ new_value }) => new_value)
  for (const { table, column } of [...JSON_COLUMNS, ...REWRITTEN_COLUMNS]) {
    if (!columnExists(db, table, column)) continue
    const keyColumns = primaryKeyColumns(db, table)
    if (keyColumns.length === 0) throw new Error(`d1_plan_stable_key_missing:${table}`)
    const rows = db
      .prepare(
        `SELECT ${keyColumns.map(quoteName).join(', ')}, ${quoteName(column)} AS migration_value
         FROM ${quoteName(table)} WHERE ${quoteName(column)} IS NOT NULL`,
      )
      .all() as Array<Record<string, string | number> & { migration_value: string }>
    const exactRows = rows.flatMap((row) => {
      if (!newValues.some((value) => row.migration_value.includes(value))) return []
      return [
        `(${sqlLiteral(table)}, ${sqlLiteral(column)}, ${sqlLiteral(JSON.stringify(keyColumns.map((key) => row[key])))}, ${sqlLiteral(row.migration_value)})`,
      ]
    })
    for (const chunk of chunkSqlFragments(exactRows)) {
      statements.push(
        `INSERT INTO ${EXACT_VALUE_TABLE} (target_table, target_column, key_json, value)
         VALUES ${chunk.join(', ')}
         ON CONFLICT(target_table, target_column, key_json) DO UPDATE SET value = excluded.value;`,
      )
    }
    if (exactRows.length === 0) continue
    const keyJson = `json_array(${keyColumns.map((key) => `source.${quoteName(key)}`).join(', ')})`
    const exactPredicate = `expected.target_table = ${sqlLiteral(table)} AND expected.target_column = ${sqlLiteral(column)} AND expected.key_json = ${keyJson}`
    statements.push(
      `UPDATE ${quoteName(table)} AS source
       SET ${quoteName(column)} = (
         SELECT expected.value FROM ${EXACT_VALUE_TABLE} expected WHERE ${exactPredicate}
       )
       WHERE ${normalizationPending} AND EXISTS (
         SELECT 1 FROM ${EXACT_VALUE_TABLE} expected WHERE ${exactPredicate}
       );`,
    )
    addAssertion(
      `exact:${table}.${column}`,
      `SELECT
         ABS(
           (SELECT COUNT(*) FROM ${EXACT_VALUE_TABLE}
            WHERE target_table = ${sqlLiteral(table)} AND target_column = ${sqlLiteral(column)})
           -
           (SELECT COUNT(*) FROM ${quoteName(table)} source
            INNER JOIN ${EXACT_VALUE_TABLE} expected ON ${exactPredicate})
         )
         +
         (SELECT COUNT(*) FROM ${quoteName(table)} source
          INNER JOIN ${EXACT_VALUE_TABLE} expected ON ${exactPredicate}
          WHERE source.${quoteName(column)} IS NOT expected.value)`,
    )
  }
  if (
    columnExists(db, 'downloaders', 'id') &&
    columnExists(db, 'downloaders', 'token_hash') &&
    columnExists(db, 'downloaders', 'token_jti') &&
    columnExists(db, 'downloaders', 'enabled')
  ) {
    const rows = db.prepare('SELECT id, token_hash, token_jti, enabled FROM downloaders').all() as Array<{
      id: string
      token_hash: string
      token_jti: string
      enabled: number
    }>
    for (const row of rows) {
      statements.push(
        `UPDATE downloaders SET token_hash = ${sqlLiteral(row.token_hash)}, token_jti = ${sqlLiteral(row.token_jti)}, enabled = ${row.enabled} WHERE ${normalizationPending} AND id = ${sqlLiteral(row.id)};`,
      )
      addAssertion(
        `downloader-credential:${row.id}`,
        `SELECT ABS(COUNT(*) - 1) + COALESCE(SUM(CASE WHEN token_hash IS NOT ${sqlLiteral(row.token_hash)} OR token_jti IS NOT ${sqlLiteral(row.token_jti)} OR enabled IS NOT ${row.enabled} THEN 1 ELSE 0 END), 0) FROM downloaders WHERE id = ${sqlLiteral(row.id)}`,
      )
    }
    addAssertion(
      'downloader-credentials-revoked',
      "SELECT COUNT(*) FROM downloaders WHERE enabled != 0 OR token_hash != ''",
    )
  }
  for (const table of INVALIDATE_TABLES) {
    if (tableExists(db, table)) statements.push(`DELETE FROM ${quoteName(table)} WHERE ${normalizationPending};`)
  }
  if (columnExists(db, 'oauthClientRegistration', 'client_id') && columnExists(db, 'oauthClient', 'client_id')) {
    if (columnExists(db, 'oauthClientResource', 'client_id')) {
      statements.push(
        `DELETE FROM oauthClientResource WHERE ${normalizationPending} AND client_id IN (SELECT client_id FROM oauthClientRegistration);`,
      )
    }
    statements.push(
      `DELETE FROM oauthClient WHERE ${normalizationPending} AND EXISTS (SELECT 1 FROM oauthClientRegistration registration WHERE registration.client_id = oauthClient.client_id);`,
      `DELETE FROM oauthClientRegistration WHERE ${normalizationPending};`,
    )
  }
  for (const assertion of deferredAssertions) addAssertion(assertion.name, assertion.countSql)
  const tables = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_zpan_id_normalization_%' AND name NOT GLOB '_cf_*'",
      )
      .all() as Array<{ name: string }>
  ).map(({ name }) => name)
  for (const table of tables) {
    addAssertion(`row-count:${table}`, `SELECT ABS(COUNT(*) - ${rowCount(db, table)}) FROM ${quoteName(table)}`)
  }
  addAssertion('foreign-keys', 'SELECT COUNT(*) FROM pragma_foreign_key_check')

  for (const spec of VALUE_SPECS) {
    for (const [target, allowEmpty] of [
      [{ table: spec.table, column: spec.column }, false] as const,
      ...(spec.references ?? []).map(
        (reference) => [reference, EMPTY_REFERENCE_SENTINELS.has(`${reference.table}.${reference.column}`)] as const,
      ),
    ]) {
      if (!columnExists(db, target.table, target.column)) continue
      const column = quoteName(target.column)
      addAssertion(
        `format:${target.table}.${target.column}`,
        `SELECT COUNT(*) FROM ${quoteName(target.table)} WHERE ${column} IS NOT NULL AND (${invalidValuePredicate(spec, column, allowEmpty)})`,
      )
    }
  }
  for (const { table, column } of VALIDATE_ONLY_COLUMNS) {
    if (!columnExists(db, table, column)) continue
    addAssertion(
      `format:${table}.${column}`,
      `SELECT COUNT(*) FROM ${quoteName(table)} WHERE ${quoteName(column)} IS NOT NULL AND (${quoteName(column)} = '' OR ${quoteName(column)} GLOB '*[^A-Za-z0-9]*')`,
    )
  }
  for (const spec of VALUE_SPECS) {
    if (!columnExists(db, spec.table, spec.column)) continue
    for (const reference of spec.references ?? []) {
      if (!columnExists(db, reference.table, reference.column)) continue
      if (reference.allowDangling) continue
      addAssertion(
        `reference:${reference.table}.${reference.column}`,
        `SELECT COUNT(*) FROM ${quoteName(reference.table)} source WHERE source.${quoteName(reference.column)} IS NOT NULL AND source.${quoteName(reference.column)} != '' AND NOT EXISTS (SELECT 1 FROM ${quoteName(spec.table)} target WHERE target.${quoteName(spec.column)} = source.${quoteName(reference.column)})`,
      )
    }
  }
  for (const { table, typeColumn, valueColumn, typeKinds } of POLYMORPHIC_REFERENCES) {
    if (!columnExists(db, table, typeColumn) || !columnExists(db, table, valueColumn)) continue
    const knownTypes = Object.keys(typeKinds).map(sqlLiteral).join(', ')
    addAssertion(
      `polymorphic-format:${table}.${valueColumn}`,
      `SELECT COUNT(*) FROM ${quoteName(table)} source WHERE source.${quoteName(typeColumn)} IN (${knownTypes}) ${table === 'cloud_traffic_reports' ? "AND source.status != 'ledger_opening'" : ''} ${table === 'resource_changes' && valueColumn === 'resource_id' ? "AND NOT (source.resource_type = 'notification' AND source.resource_id = '*')" : ''} AND source.${quoteName(valueColumn)} IS NOT NULL AND source.${quoteName(valueColumn)} != '' AND source.${quoteName(valueColumn)} GLOB '*[^A-Za-z0-9]*'`,
    )
    for (const [type, kind] of Object.entries(typeKinds)) {
      if (polymorphicAllowsDangling(table)) continue
      const spec = targetSpec(kind)
      if (!spec || !columnExists(db, spec.table, spec.column)) continue
      addAssertion(
        `polymorphic-reference:${table}.${valueColumn}:${type}`,
        `SELECT COUNT(*) FROM ${quoteName(table)} source WHERE source.${quoteName(typeColumn)} = ${sqlLiteral(type)} AND source.${quoteName(valueColumn)} IS NOT NULL AND source.${quoteName(valueColumn)} != '' ${polymorphicException(table, valueColumn)} AND NOT EXISTS (SELECT 1 FROM ${quoteName(spec.table)} target WHERE target.${quoteName(spec.column)} = source.${quoteName(valueColumn)})`,
      )
    }
  }
  for (const source of JSON_COLUMNS) {
    if (!columnExists(db, source.table, source.column)) continue
    const table = quoteName(source.table)
    const column = quoteName(source.column)
    addAssertion(
      `json-valid:${source.table}.${source.column}`,
      `SELECT COUNT(*) FROM ${table} WHERE ${column} IS NOT NULL AND json_valid(${column}) = 0`,
    )
    const effectiveKey = `CASE WHEN typeof(node.key) = 'integer' THEN (SELECT parent.key FROM json_tree(source.${column}) parent WHERE parent.id = node.parent) ELSE node.key END`
    for (const [kind, keys] of jsonReferenceKeys(source)) {
      const spec = targetSpec(kind)
      if (!spec || !columnExists(db, spec.table, spec.column)) continue
      addAssertion(
        `json-format:${source.table}.${source.column}:${kind}`,
        `SELECT COUNT(*) FROM ${table} source, json_tree(source.${column}) node
         WHERE node.type = 'text' AND ${effectiveKey} IN (${keys.map(sqlLiteral).join(', ')})
           AND (${invalidValuePredicate(spec, 'node.value', false)})`,
      )
      if (jsonAllowsDangling(source)) continue
      addAssertion(
        `json-reference:${source.table}.${source.column}:${kind}`,
        `SELECT COUNT(*) FROM ${table} source, json_tree(source.${column}) node
         WHERE node.type = 'text' AND ${effectiveKey} IN (${keys.map(sqlLiteral).join(', ')})
           AND NOT EXISTS (
             SELECT 1 FROM ${quoteName(spec.table)} target
             WHERE target.${quoteName(spec.column)} = node.value
           )`,
      )
    }
    if (source.table === 'download_tasks' && source.column === 'events') {
      addAssertion(
        'json-format:download_tasks.events:initial-task',
        `SELECT COUNT(*) FROM download_tasks source, json_tree(source.events) node
         WHERE node.type = 'text' AND node.key = 'id' AND node.value LIKE 'initial:%'
           AND (substr(node.value, 9) = '' OR substr(node.value, 9) GLOB '*[^A-Za-z0-9]*')`,
      )
      addAssertion(
        'json-reference:download_tasks.events:initial-task',
        `SELECT COUNT(*) FROM download_tasks source, json_tree(source.events) node
         WHERE node.type = 'text' AND node.key = 'id' AND node.value LIKE 'initial:%'
           AND NOT EXISTS (SELECT 1 FROM download_tasks target WHERE target.id = substr(node.value, 9))`,
      )
    }
  }
  if (columnExists(db, 'object_upload_sessions', 'created_by')) {
    addAssertion(
      'structured-format:object_upload_sessions.created_by',
      `SELECT COUNT(*) FROM object_upload_sessions WHERE created_by = '' OR (created_by GLOB '*[^A-Za-z0-9]*' AND NOT (created_by LIKE 'downloader:%' AND substr(created_by, 12) != '' AND substr(created_by, 12) NOT GLOB '*[^A-Za-z0-9]*'))`,
    )
    addAssertion(
      'structured-reference:object_upload_sessions.created_by',
      `SELECT COUNT(*) FROM object_upload_sessions source WHERE (source.created_by LIKE 'downloader:%' AND NOT EXISTS (SELECT 1 FROM downloaders target WHERE target.id = substr(source.created_by, 12))) OR (source.created_by NOT LIKE 'downloader:%' AND NOT EXISTS (SELECT 1 FROM user target WHERE target.id = source.created_by))`,
    )
  }
  const completedAt = valueFromState(db, 'completed_at')
  statements.push(
    `INSERT INTO ${STATE_TABLE} (key, value) VALUES ('validation_version', ${sqlLiteral(VALIDATION_VERSION)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    `INSERT INTO ${STATE_TABLE} (key, value) VALUES ('completed_at', ${sqlLiteral(completedAt)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    'PRAGMA foreign_key_check;',
  )
  const commands = statements.filter((statement) => !statement.startsWith('--'))
  for (const [index, statement] of commands.entries()) {
    const bytes = Buffer.byteLength(statement)
    if (bytes > D1_MAX_STATEMENT_BYTES) {
      throw new Error(`d1_plan_statement_limit_exceeded:${index + 1}:${bytes}`)
    }
  }
  if (commands.length > D1_MAX_COMMANDS) throw new Error(`d1_plan_command_limit_exceeded:${commands.length}`)
  return `${statements.join('\n')}\n`
}

function valueFromState(db: Database.Database, key: string): string {
  const row = db.prepare(`SELECT value FROM ${STATE_TABLE} WHERE key = ?`).get(key) as { value?: string } | undefined
  if (!row?.value) throw new Error(`normalization_state_missing:${key}`)
  return row.value
}

function parseArgs(argv: string[]): { path: string; apply: boolean; backup?: string; d1Plan?: string } {
  const sqliteIndex = argv.indexOf('--sqlite')
  if (sqliteIndex < 0 || !argv[sqliteIndex + 1]) {
    throw new Error(
      'Usage: pnpm ids:normalize -- --sqlite <path> [--apply --backup <path> [--emit-d1-sql <path>]]',
    )
  }
  const apply = argv.includes('--apply')
  const backupIndex = argv.indexOf('--backup')
  const backup = backupIndex >= 0 ? argv[backupIndex + 1] : undefined
  const d1PlanIndex = argv.indexOf('--emit-d1-sql')
  const d1Plan = d1PlanIndex >= 0 ? argv[d1PlanIndex + 1] : undefined
  if (apply && !backup) throw new Error('id_normalization_backup_required')
  if (d1Plan && !apply) throw new Error('d1_plan_requires_apply')
  return { path: argv[sqliteIndex + 1]!, apply, backup, d1Plan }
}

export async function runNormalizationCli(
  argv: string[],
  write: (value: string) => void = (value) => process.stdout.write(value),
): Promise<void> {
  const options = parseArgs(argv)
  const path = resolve(options.path)
  if (!existsSync(path)) throw new Error(`sqlite_database_missing:${path}`)
  const db = new Database(path, options.apply ? undefined : { readonly: false })
  try {
    assertSchemaReady(db)
    if (options.apply && options.backup) {
      const backup = resolve(options.backup)
      if (existsSync(backup)) throw new Error(`backup_already_exists:${backup}`)
      writeFileSync(backup, '', { mode: 0o600, flag: 'wx' })
      try {
        await db.backup(backup)
        chmodSync(backup, 0o600)
      } catch (error) {
        unlinkSync(backup)
        throw error
      }
    }
    db.pragma('foreign_keys = OFF')
    const summary = normalizeDatabase(db, options.apply)
    if (options.d1Plan) {
      const d1Plan = resolve(options.d1Plan)
      if (existsSync(d1Plan)) throw new Error(`d1_plan_already_exists:${d1Plan}`)
      writeFileSync(d1Plan, buildD1ApplySql(db), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    }
    write(`${JSON.stringify(summary, null, 2)}\n`)
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runNormalizationCli(process.argv.slice(2))
}
