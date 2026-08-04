import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  ID_NORMALIZATION_DATA_TABLES,
  INVALIDATED_CREDENTIAL_TABLES,
  OWNED_ID_TABLES,
} from '../shared/id-normalization-inventory'
import { DEFAULT_ID_LENGTH, generateToken, isBase62 } from '../shared/ids'

const MAP_TABLE = '_zpan_id_backfill_map'
const ID_NAMESPACE = 'id'
const COMPLETION_KEY = 'id_normalization_version'
const COMPLETION_VERSION = '1'
const PENDING_DIGEST_KEY = 'id_normalization_pending_artifact_digest'
const APPLIED_DIGEST_KEY = 'id_normalization_applied_artifact_digest'
const D1_MAX_ARTIFACT_STATEMENTS = 47
const REDIRECT_TOKEN_NAMESPACES = new Set(['token:shares.token', 'token:image_hostings.token'])

const LOCAL_REFERENCE_COLUMNS = [
  ['matters', 'org_id'], ['matters', 'storage_id'], ['org_quotas', 'org_id'],
  ['account', 'user_id'], ['member', 'organization_id'], ['member', 'user_id'],
  ['invitation', 'organization_id'], ['invitation', 'inviter_id'],
  ['invite_codes', 'created_by'], ['invite_codes', 'used_by'],
  ['team_invite_links', 'organization_id'], ['team_invite_links', 'inviter_id'],
  ['shares', 'matter_id'], ['shares', 'org_id'], ['shares', 'creator_id'],
  ['share_recipients', 'share_id'], ['share_recipients', 'recipient_user_id'],
  ['notifications', 'user_id'], ['notifications', 'ref_id'],
  ['image_hosting_configs', 'org_id'], ['image_hostings', 'org_id'], ['image_hostings', 'storage_id'],
  ['apikey', 'reference_id'], ['site_invitations', 'invited_by'], ['site_invitations', 'accepted_by'],
  ['site_invitations', 'revoked_by'], ['announcements', 'created_by'],
  ['org_quota_entitlements', 'org_id'], ['cloud_traffic_reports', 'org_id'],
  ['cloud_traffic_reports', 'storage_id'], ['background_jobs', 'org_id'], ['background_jobs', 'user_id'],
  ['background_jobs', 'retried_from_job_id'], ['webdav_dead_properties', 'org_id'], ['webdav_locks', 'org_id'],
  ['download_tasks', 'org_id'], ['download_tasks', 'created_by_user_id'],
  ['download_tasks', 'assigned_downloader_id'], ['download_tasks', 'result_object_id'],
  ['remote_download_usage_reports', 'org_id'], ['remote_download_usage_reports', 'downloader_id'],
  ['remote_download_usage_reports', 'task_id'], ['object_upload_sessions', 'org_id'],
  ['object_upload_sessions', 'object_id'], ['object_upload_sessions', 'storage_id'],
  ['object_upload_sessions', 'created_by'],
  ['downloaders', 'created_by'], ['stats_rollups_hourly', 'org_id'], ['audit_events', 'org_id'],
  ['audit_events', 'user_id'], ['storage_usage_ledger', 'org_id'], ['storage_usage_ledger', 'storage_id'],
  ['storage_usage_breakdowns', 'org_id'], ['resource_changes', 'scope_id'],
  ['resource_changes', 'resource_id'], ['oauthClient', 'user_id'], ['x402_capacity_purchase_intents', 'org_id'],
] as const

const GENERAL_LOCAL_JSON_ID_KEYS = [
  'shareId', 'matterId', 'storageId', 'userId', 'workspaceId', 'orgId', 'organizationId',
  'downloaderId', 'taskId', 'objectId', 'imageId', 'resultObjectId', 'recipientUserId', 'scopeId',
  'jobId', 'sessionId', 'entitlementId',
] as const

export const TOKEN_COLUMNS = [
  { table: 'matters', column: 'alias', length: 11 },
  { table: 'invite_codes', column: 'code', length: 8 },
  { table: 'site_invitations', column: 'token', length: 33 },
  { table: 'team_invite_links', column: 'token', length: 32 },
  { table: 'shares', column: 'token', length: 11 },
  { table: 'image_hostings', column: 'token', length: 12 },
  { table: 'image_hosting_configs', column: 'verification_token', length: 33 },
  { table: 'downloaders', column: 'token_jti', length: DEFAULT_ID_LENGTH },
] as const

const JSON_COLUMNS = [
  { table: 'notifications', key: 'id', columns: ['metadata'], idKeys: ['shareId', 'matterId', 'jobId'], arrayIdKeys: [], shareTokenKeys: ['token'] },
  { table: 'background_jobs', key: 'id', columns: ['metadata', 'result_metadata'], idKeys: [...GENERAL_LOCAL_JSON_ID_KEYS], arrayIdKeys: ['matterIds'], shareTokenKeys: [] },
  { table: 'download_tasks', key: 'id', columns: ['events'], idKeys: [...GENERAL_LOCAL_JSON_ID_KEYS], arrayIdKeys: ['matterIds'], shareTokenKeys: [] },
  { table: 'audit_events', key: 'id', columns: ['metadata'], idKeys: [...GENERAL_LOCAL_JSON_ID_KEYS, 'sourceId'], arrayIdKeys: ['matterIds'], shareTokenKeys: [] },
  { table: 'resource_changes', key: 'sequence', columns: ['metadata'], idKeys: [...GENERAL_LOCAL_JSON_ID_KEYS], arrayIdKeys: ['matterIds'], shareTokenKeys: [] },
  { table: 'stats_rollups_hourly', key: 'id', columns: ['metadata'], idKeys: [...GENERAL_LOCAL_JSON_ID_KEYS], arrayIdKeys: [], shareTokenKeys: [] },
  { table: 'org_quota_entitlements', key: 'id', columns: ['metadata'], idKeys: ['grantedBy', 'updatedBy', 'revokedBy'], arrayIdKeys: [], shareTokenKeys: [] },
  { table: 'apikey', key: 'id', columns: ['metadata'], idKeys: ['workspaceId', 'orgId', 'userId'], arrayIdKeys: [], shareTokenKeys: [] },
] as const

export function idBackfillDataTables(): string[] {
  return [
    ...new Set([
      ...OWNED_ID_TABLES,
      ...INVALIDATED_CREDENTIAL_TABLES,
      ...TOKEN_COLUMNS.map(({ table }) => table),
      ...LOCAL_REFERENCE_COLUMNS.map(([table]) => table),
      ...JSON_COLUMNS.map(({ table }) => table),
      'redirect_token_registry',
    ]),
  ].sort()
}

if (idBackfillDataTables().join('\0') !== [...ID_NORMALIZATION_DATA_TABLES].sort().join('\0')) {
  throw new Error('id_normalization_inventory_mismatch')
}

export interface BackfillMapping {
  namespace: string
  oldValue: string
  newValue: string
}

export interface BackfillSummary {
  invalidIds: number
  invalidTokens: number
  mappings: number
  tokenRotations: number
  credentialsToInvalidate: number
  jsonDocumentsToRewrite: number
  ambiguousRedirectTokens: number
}

export interface BackfillPlan {
  sql: string[]
  mappings: BackfillMapping[]
  before: BackfillSummary
}

function ident(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function indexExists(db: Database.Database, index: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index))
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${ident(table)})`).all() as Array<{ name: string }>).map((row) => row.name)
}

function tableHasRows(db: Database.Database, table: string, where = ''): boolean {
  if (!tableExists(db, table)) return false
  return Boolean(db.prepare(`SELECT 1 FROM ${ident(table)}${where ? ` WHERE ${where}` : ''} LIMIT 1`).get())
}

function columnHasMapping(
  db: Database.Database,
  table: string,
  column: string,
  mappings: readonly BackfillMapping[],
  namespace = ID_NAMESPACE,
): boolean {
  if (!tableExists(db, table) || !columns(db, table).includes(column)) return false
  const oldValues = new Set(mappings.filter((entry) => entry.namespace === namespace).map((entry) => entry.oldValue))
  if (oldValues.size === 0) return false
  const values = db
    .prepare(`SELECT DISTINCT ${ident(column)} AS value FROM ${ident(table)} WHERE ${ident(column)} IS NOT NULL`)
    .all() as Array<{ value: unknown }>
  return values.some(({ value }) => typeof value === 'string' && oldValues.has(value))
}

function existingMappings(db: Database.Database): BackfillMapping[] {
  if (!tableExists(db, MAP_TABLE)) return []
  return db
    .prepare(`SELECT namespace, old_value AS oldValue, new_value AS newValue FROM ${ident(MAP_TABLE)}`)
    .all() as BackfillMapping[]
}

function assertNotFinalized(db: Database.Database): void {
  if (!tableExists(db, 'system_options')) return
  const marker = db.prepare('SELECT value FROM system_options WHERE key = ?').get(COMPLETION_KEY) as
    | { value: string }
    | undefined
  if (marker) throw new Error(`id_backfill_already_finalized:${marker.value}`)
}

export function backfillPlanDigest(plan: Pick<BackfillPlan, 'sql'>): string {
  return createHash('sha256').update(JSON.stringify(plan.sql)).digest('hex')
}

export function pendingBackfillDigest(db: Database.Database): string | undefined {
  if (!tableExists(db, 'system_options')) return undefined
  return (
    db.prepare('SELECT value FROM system_options WHERE key = ?').get(PENDING_DIGEST_KEY) as
      | { value: string }
      | undefined
  )?.value
}

function invalidValues(db: Database.Database, table: string, column: string): string[] {
  if (!tableExists(db, table) || !columns(db, table).includes(column)) return []
  const rows = db.prepare(`SELECT DISTINCT ${ident(column)} AS value FROM ${ident(table)}`).all() as Array<{
    value: unknown
  }>
  return rows.flatMap(({ value }) => (typeof value === 'string' && !isBase62(value) ? [value] : []))
}

function collectMappings(db: Database.Database): BackfillMapping[] {
  const persisted = existingMappings(db)
  const byKey = new Map(persisted.map((entry) => [`${entry.namespace}\0${entry.oldValue}`, entry]))
  const used = new Map<string, Set<string>>()
  const reserve = (namespace: string, value: string): void => {
    const values = used.get(namespace) ?? new Set<string>()
    values.add(value)
    used.set(namespace, values)
    if (REDIRECT_TOKEN_NAMESPACES.has(namespace)) {
      const redirectValues = used.get('redirect-token') ?? new Set<string>()
      redirectValues.add(value)
      used.set('redirect-token', redirectValues)
    }
  }
  for (const entry of persisted) reserve(entry.namespace, entry.newValue)
  for (const table of OWNED_ID_TABLES) {
    if (!tableExists(db, table) || !columns(db, table).includes('id')) continue
    const rows = db.prepare(`SELECT id FROM ${ident(table)}`).all() as Array<{ id: string }>
    for (const row of rows) if (isBase62(row.id)) reserve(ID_NAMESPACE, row.id)
  }
  const uniqueValue = (namespace: string, length: number): string => {
    let candidate = generateToken(length)
    while (used.get(namespace)?.has(candidate) || (REDIRECT_TOKEN_NAMESPACES.has(namespace) && used.get('redirect-token')?.has(candidate))) {
      candidate = generateToken(length)
    }
    reserve(namespace, candidate)
    if (REDIRECT_TOKEN_NAMESPACES.has(namespace)) reserve('redirect-token', candidate)
    return candidate
  }
  for (const table of OWNED_ID_TABLES) {
    for (const oldValue of invalidValues(db, table, 'id')) {
      const key = `${ID_NAMESPACE}\0${oldValue}`
      if (!byKey.has(key)) {
        byKey.set(key, { namespace: ID_NAMESPACE, oldValue, newValue: uniqueValue(ID_NAMESPACE, DEFAULT_ID_LENGTH) })
      }
    }
  }
  for (const token of TOKEN_COLUMNS) {
    const namespace = `token:${token.table}.${token.column}`
    const settledValues = new Set(persisted.filter((entry) => entry.namespace === namespace).map((entry) => entry.newValue))
    if (tableExists(db, token.table)) {
      const rows = db.prepare(`SELECT ${ident(token.column)} AS value FROM ${ident(token.table)}`).all() as Array<{
        value: unknown
      }>
      const changed: Array<{ rowKey: string | number; document: string }> = []
      for (const row of rows) {
        if (typeof row.value !== 'string') continue
        reserve(namespace, row.value)
        if (settledValues.has(row.value)) continue
        const key = `${namespace}\0${row.value}`
        if (!byKey.has(key)) {
          byKey.set(key, { namespace, oldValue: row.value, newValue: uniqueValue(namespace, token.length) })
        }
      }
    }
  }
  if (tableExists(db, 'system_options')) {
    const row = db.prepare("SELECT value FROM system_options WHERE key = 'instance_id'").get() as
      | { value: string }
      | undefined
    if (row && !isBase62(row.value)) {
      const namespace = 'token:system_options.instance_id'
      const key = `${namespace}\0${row.value}`
      if (!byKey.has(key)) {
        byKey.set(key, { namespace, oldValue: row.value, newValue: uniqueValue(namespace, DEFAULT_ID_LENGTH) })
      }
    }
  }
  return [...byKey.values()]
}

function rewriteJson(
  value: unknown,
  replacement: ReadonlyMap<string, string>,
  shareTokenReplacement: ReadonlyMap<string, string>,
  idKeys: ReadonlySet<string>,
  arrayIdKeys: ReadonlySet<string>,
  shareTokenKeys: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      rewriteJson(item, replacement, shareTokenReplacement, idKeys, arrayIdKeys, shareTokenKeys),
    )
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      idKeys.has(key) && typeof item === 'string'
        ? replacement.get(item) ?? item
        : arrayIdKeys.has(key) && Array.isArray(item)
          ? item.map((entry) => (typeof entry === 'string' ? replacement.get(entry) ?? entry : entry))
          : shareTokenKeys.has(key) && typeof item === 'string'
            ? shareTokenReplacement.get(item) ?? item
            : rewriteJson(item, replacement, shareTokenReplacement, idKeys, arrayIdKeys, shareTokenKeys),
    ]),
  )
}

function jsonUpdates(
  db: Database.Database,
  mappings: BackfillMapping[],
): { statements: string[]; documentCount: number } {
  const replacement = new Map<string, string>()
  for (const { oldValue, newValue } of mappings.filter(({ namespace }) => namespace === ID_NAMESPACE)) {
    const existing = replacement.get(oldValue)
    if (existing && existing !== newValue) throw new Error('ambiguous_embedded_mapping')
    replacement.set(oldValue, newValue)
  }
  const shareTokenReplacement = new Map(
    mappings
      .filter(({ namespace }) => namespace === 'token:shares.token')
      .map(({ oldValue, newValue }) => [oldValue, newValue]),
  )
  const updates: string[] = []
  let documentCount = 0
  for (const config of JSON_COLUMNS) {
    const idKeys = new Set<string>(config.idKeys)
    const arrayIdKeys = new Set<string>(config.arrayIdKeys)
    const shareTokenKeys = new Set<string>(config.shareTokenKeys)
    if (!tableExists(db, config.table)) continue
    const available = new Set(columns(db, config.table))
    if (!available.has(config.key)) continue
    for (const column of config.columns) {
      if (!available.has(column)) continue
      const rows = db
        .prepare(
          `SELECT ${ident(config.key)} AS rowKey, ${ident(column)} AS document FROM ${ident(config.table)} WHERE ${ident(column)} IS NOT NULL`,
        )
        .all() as Array<{ rowKey: string | number; document: string }>
      const changed: Array<{ rowKey: string | number; document: string }> = []
      for (const row of rows) {
        let parsed: unknown
        try {
          parsed = JSON.parse(row.document)
        } catch {
          throw new Error(`invalid_json:${config.table}.${column}`)
        }
        const rewritten = JSON.stringify(
          rewriteJson(parsed, replacement, shareTokenReplacement, idKeys, arrayIdKeys, shareTokenKeys),
        )
        if (rewritten === row.document) continue
        changed.push({ rowKey: row.rowKey, document: rewritten })
        documentCount += 1
      }
      let batch: typeof changed = []
      const build = (entries: typeof changed): string => {
        const cases = entries
          .map(({ rowKey, document }) => {
            const key = typeof rowKey === 'number' ? String(rowKey) : literal(rowKey)
            return `WHEN ${key} THEN ${literal(document)}`
          })
          .join(' ')
        const keys = entries
          .map(({ rowKey }) => (typeof rowKey === 'number' ? String(rowKey) : literal(rowKey)))
          .join(', ')
        return `UPDATE ${ident(config.table)} SET ${ident(column)} = CASE ${ident(config.key)} ${cases} END WHERE ${ident(config.key)} IN (${keys});`
      }
      for (const entry of changed) {
        const candidate = [...batch, entry]
        if (batch.length > 0 && Buffer.byteLength(build(candidate), 'utf8') > 95_000) {
          updates.push(build(batch))
          batch = [entry]
        } else {
          batch = candidate
        }
      }
      if (batch.length > 0) updates.push(build(batch))
    }
  }
  return { statements: updates, documentCount }
}

function mappingTableSql(): string {
  return `CREATE TABLE IF NOT EXISTS ${ident(MAP_TABLE)} (namespace TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT NOT NULL, PRIMARY KEY (namespace, old_value), UNIQUE (namespace, new_value));`
}

function mapExpression(column: string, namespace = ID_NAMESPACE): string {
  return `(SELECT new_value FROM ${ident(MAP_TABLE)} WHERE namespace = ${literal(namespace)} AND old_value = ${ident(column)})`
}

function mapPredicate(column: string, namespace = ID_NAMESPACE): string {
  return `EXISTS (SELECT 1 FROM ${ident(MAP_TABLE)} WHERE namespace = ${literal(namespace)} AND old_value = ${ident(column)})`
}

function updateSql(db: Database.Database, mappings: BackfillMapping[]): string[] {
  const sql: string[] = ['PRAGMA defer_foreign_keys = ON;', mappingTableSql()]
  for (let offset = 0; offset < mappings.length; offset += 500) {
    const values = mappings
      .slice(offset, offset + 500)
      .map((entry) => `(${literal(entry.namespace)}, ${literal(entry.oldValue)}, ${literal(entry.newValue)})`)
      .join(', ')
    sql.push(
      `INSERT OR IGNORE INTO ${ident(MAP_TABLE)} (namespace, old_value, new_value) VALUES ${values};`,
    )
  }
  sql.push(...jsonUpdates(db, mappings).statements)

  if (!tableExists(db, 'audit_events') || !columns(db, 'audit_events').includes('event_key')) {
    throw new Error('required_migration_missing:audit_events.event_key')
  }
  if (!tableExists(db, 'redirect_token_registry')) {
    throw new Error('required_migration_missing:redirect_token_registry')
  }
  if (!indexExists(db, 'redirect_token_registry_kind_resource_id_unique')) {
    throw new Error('required_migration_missing:redirect_token_registry_kind_resource_id_unique')
  }
  if (tableHasRows(db, 'audit_events', "event_key IS NULL AND (id LIKE 'event:%' OR id LIKE 'audit:%')")) {
    sql.push("UPDATE audit_events SET event_key = id WHERE event_key IS NULL AND (id LIKE 'event:%' OR id LIKE 'audit:%');")
  }

  const tableUpdates = new Map<string, { assignments: string[]; predicates: string[] }>()
  const addUpdate = (table: string, column: string, expression: string, predicate: string): void => {
    const update = tableUpdates.get(table) ?? { assignments: [], predicates: [] }
    update.assignments.push(`${ident(column)} = CASE WHEN ${predicate} THEN ${expression} ELSE ${ident(column)} END`)
    update.predicates.push(predicate)
    tableUpdates.set(table, update)
  }
  const addMappedUpdate = (table: string, column: string, namespace = ID_NAMESPACE, extra = ''): void => {
    if (!columnHasMapping(db, table, column, mappings, namespace)) return
    const predicate = `${extra ? `${extra} AND ` : ''}${mapPredicate(column, namespace)}`
    addUpdate(table, column, mapExpression(column, namespace), predicate)
  }

  for (const [table, column] of LOCAL_REFERENCE_COLUMNS) addMappedUpdate(table, column)
  addMappedUpdate(
    'audit_events',
    'target_id',
    ID_NAMESPACE,
    "target_type IN ('team','user','file','folder','share','image','remote_download','quota')",
  )
  addMappedUpdate(
    'audit_events',
    'actor_ref',
    ID_NAMESPACE,
    "actor_type IN ('api_key','downloader','task-upload')",
  )
  addMappedUpdate(
    'storage_usage_ledger',
    'resource_id',
    ID_NAMESPACE,
    "resource_type IN ('matter','image_hosting','storage')",
  )
  addMappedUpdate(
    'cloud_traffic_reports',
    'source_id',
    ID_NAMESPACE,
    "source IN ('object_download','webdav_download','direct_share','landing_share','image_hosting','custom_domain_image')",
  )
  const idOldValues = mappings.filter(({ namespace }) => namespace === ID_NAMESPACE).map(({ oldValue }) => oldValue)
  for (const table of ['audit_events', 'storage_usage_ledger'].filter((table) => {
    if (!tableHasRows(db, table)) return false
    const eventKeys = db
      .prepare(`SELECT COALESCE(event_key, id) AS value FROM ${ident(table)}`)
      .all() as Array<{ value: string }>
    return eventKeys.some(({ value }) => idOldValues.some((oldValue) => value.includes(oldValue)))
  })) {
    sql.push(rewriteStructuredReferencesSql(table, 'event_key'))
  }
  if (tableHasRows(db, 'object_upload_sessions', "created_by LIKE 'downloader:%'")) {
    const predicate = `created_by LIKE 'downloader:%' AND EXISTS (
  SELECT 1 FROM ${ident(MAP_TABLE)}
  WHERE namespace = ${literal(ID_NAMESPACE)} AND old_value = substr(object_upload_sessions.created_by, 12)
)`
    addUpdate(
      'object_upload_sessions',
      'created_by',
      `'downloader:' || (
  SELECT new_value FROM ${ident(MAP_TABLE)}
  WHERE namespace = ${literal(ID_NAMESPACE)} AND old_value = substr(object_upload_sessions.created_by, 12)
)
`,
      predicate,
    )
  }

  for (const table of OWNED_ID_TABLES) {
    addMappedUpdate(table, 'id')
  }
  for (const token of TOKEN_COLUMNS) {
    const namespace = `token:${token.table}.${token.column}`
    addMappedUpdate(token.table, token.column, namespace)
  }
  addMappedUpdate('system_options', 'value', 'token:system_options.instance_id', "key = 'instance_id'")
  addMappedUpdate('license_bindings', 'instance_id', 'token:system_options.instance_id')
  if (tableHasRows(db, 'downloaders', 'enabled != 0')) {
    addUpdate('downloaders', 'enabled', '0', 'enabled != 0')
    addUpdate('downloaders', 'status', "'offline'", 'enabled != 0')
  }
  if (tableHasRows(db, 'license_bindings')) {
    const available = new Set(columns(db, 'license_bindings'))
    addUpdate('license_bindings', 'status', "'disconnected'", '1')
    for (const column of ['refresh_token', 'cached_certificate', 'cached_certificate_expires_at']) {
      if (available.has(column)) addUpdate('license_bindings', column, 'NULL', '1')
    }
  }
  if (tableHasRows(db, 'account')) {
    const available = new Set(columns(db, 'account'))
    const credentialColumns = [
      'access_token',
      'refresh_token',
      'id_token',
      'access_token_expires_at',
      'refresh_token_expires_at',
      'scope',
    ].filter((column) => available.has(column))
    for (const column of credentialColumns) addUpdate('account', column, 'NULL', '1')
  }
  if (tableHasRows(db, 'oauthResource', 'signing_key_id IS NOT NULL')) {
    addUpdate('oauthResource', 'signing_key_id', 'NULL', 'signing_key_id IS NOT NULL')
  }
  for (const [table, update] of tableUpdates) {
    sql.push(
      `UPDATE ${ident(table)} SET ${update.assignments.join(', ')} WHERE ${update.predicates.map((predicate) => `(${predicate})`).join(' OR ')};`,
    )
  }
  if (tableExists(db, 'redirect_token_registry')) {
    if (tableHasRows(db, 'redirect_token_registry')) sql.push('DELETE FROM redirect_token_registry;')
    if (tableHasRows(db, 'shares', "kind = 'direct'")) {
      sql.push("INSERT INTO redirect_token_registry (token, kind, resource_id) SELECT token, 'direct_share', id FROM shares WHERE kind = 'direct';")
    }
    if (tableHasRows(db, 'image_hostings')) {
      sql.push("INSERT INTO redirect_token_registry (token, kind, resource_id) SELECT token, 'image_hosting', id FROM image_hostings;")
    }
  }
  for (const table of INVALIDATED_CREDENTIAL_TABLES) {
    if (tableHasRows(db, table)) sql.push(`DELETE FROM ${ident(table)};`)
  }
  return sql
}

function rewriteStructuredReferencesSql(table: string, column: string): string {
  const delimited = `namespace = ${literal(ID_NAMESPACE)} AND instr(rewritten.value, ':' || old_value || ':') > 0`
  const suffixed = `namespace = ${literal(ID_NAMESPACE)} AND substr(rewritten.value, -length(old_value) - 1) = ':' || old_value`
  return `WITH RECURSIVE rewritten(row_key, value, step) AS (
  SELECT rowid, ${ident(column)}, 0 FROM ${ident(table)} WHERE ${ident(column)} IS NOT NULL
  UNION ALL
  SELECT row_key,
    CASE
      WHEN EXISTS (SELECT 1 FROM ${ident(MAP_TABLE)} WHERE ${delimited}) THEN replace(
        value,
        ':' || (SELECT old_value FROM ${ident(MAP_TABLE)} WHERE ${delimited} LIMIT 1) || ':',
        ':' || (SELECT new_value FROM ${ident(MAP_TABLE)} WHERE ${delimited} LIMIT 1) || ':'
      )
      WHEN EXISTS (SELECT 1 FROM ${ident(MAP_TABLE)} WHERE ${suffixed}) THEN
        substr(value, 1, length(value) - length((SELECT old_value FROM ${ident(MAP_TABLE)} WHERE ${suffixed} LIMIT 1))) ||
        (SELECT new_value FROM ${ident(MAP_TABLE)} WHERE ${suffixed} LIMIT 1)
      ELSE value
    END,
    step + 1
  FROM rewritten WHERE step < 8
)
UPDATE ${ident(table)} SET ${ident(column)} = (
  SELECT value FROM rewritten WHERE row_key = ${ident(table)}.rowid ORDER BY step DESC LIMIT 1
) WHERE ${ident(column)} IS NOT NULL;`
}

function countRows(db: Database.Database, table: string): number {
  if (!tableExists(db, table)) return 0
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${ident(table)}`).get() as { count: number }).count
}

function countInvalid(db: Database.Database, table: string, column: string): number {
  return invalidValues(db, table, column).length
}

function preservedRowCounts(db: Database.Database): Map<string, number> {
  const invalidated = new Set<string>(INVALIDATED_CREDENTIAL_TABLES)
  const derived = new Set(['redirect_token_registry'])
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>
  return new Map(
    rows
      .filter(({ name }) => name !== MAP_TABLE && !invalidated.has(name) && !derived.has(name))
      .map(({ name }) => [name, countRows(db, name)]),
  )
}

function assertPreservedRowCounts(db: Database.Database, before: ReadonlyMap<string, number>): void {
  for (const [table, count] of before) {
    const after = countRows(db, table)
    if (after !== count) throw new Error(`row_count_changed:${table}:${count}:${after}`)
  }
}

export function inspectBackfill(db: Database.Database): BackfillSummary {
  const invalidIds = OWNED_ID_TABLES.reduce((count, table) => count + countInvalid(db, table, 'id'), 0)
  let invalidTokens = TOKEN_COLUMNS.reduce((count, token) => count + countInvalid(db, token.table, token.column), 0)
  if (tableExists(db, 'system_options')) {
    const instance = db.prepare("SELECT value FROM system_options WHERE key = 'instance_id'").get() as
      | { value: string }
      | undefined
    if (instance && !isBase62(instance.value)) invalidTokens += 1
  }
  let credentialsToInvalidate = INVALIDATED_CREDENTIAL_TABLES.reduce(
    (count, table) => count + countRows(db, table),
    0,
  )
  if (tableExists(db, 'account')) {
    const available = new Set(columns(db, 'account'))
    const credentialColumns = ['access_token', 'refresh_token', 'id_token'].filter((column) => available.has(column))
    if (credentialColumns.length > 0) {
      credentialsToInvalidate += (
        db
          .prepare(`SELECT COUNT(*) AS count FROM account WHERE ${credentialColumns.map((column) => `${ident(column)} IS NOT NULL`).join(' OR ')}`)
          .get() as { count: number }
      ).count
    }
  }
  if (tableExists(db, 'downloaders') && columns(db, 'downloaders').includes('enabled')) {
    credentialsToInvalidate += (
      db.prepare('SELECT COUNT(*) AS count FROM downloaders WHERE enabled != 0').get() as { count: number }
    ).count
  }
  if (tableExists(db, 'license_bindings') && columns(db, 'license_bindings').includes('status')) {
    const available = new Set(columns(db, 'license_bindings'))
    const credentialColumns = ['refresh_token', 'cached_certificate', 'cached_certificate_expires_at'].filter((column) =>
      available.has(column),
    )
    const conditions = ["status != 'disconnected'", ...credentialColumns.map((column) => `${ident(column)} IS NOT NULL`)]
    credentialsToInvalidate += (
      db.prepare(`SELECT COUNT(*) AS count FROM license_bindings WHERE ${conditions.join(' OR ')}`).get() as { count: number }
    ).count
  }
  const mappings = existingMappings(db).length
  const jsonDocumentsToRewrite = jsonUpdates(db, collectMappings(db)).documentCount
  let ambiguousRedirectTokens = 0
  if (tableExists(db, 'shares') && tableExists(db, 'image_hostings')) {
    ambiguousRedirectTokens = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM shares s INNER JOIN image_hostings i ON i.token = s.token WHERE s.kind = 'direct' AND s.status = 'active' AND i.status = 'active'",
        )
        .get() as { count: number }
    ).count
  }
  const tokenRotations = existingMappings(db).filter(({ namespace }) => namespace.startsWith('token:')).length
  return { invalidIds, invalidTokens, mappings, tokenRotations, credentialsToInvalidate, jsonDocumentsToRewrite, ambiguousRedirectTokens }
}

export function createBackfillPlan(db: Database.Database): BackfillPlan {
  assertNotFinalized(db)
  const mappings = collectMappings(db)
  const before = {
    ...inspectBackfill(db),
    mappings: mappings.length,
    tokenRotations: mappings.filter(({ namespace }) => namespace.startsWith('token:')).length,
  }
  const sql = updateSql(db, mappings)
  if (sql.length > D1_MAX_ARTIFACT_STATEMENTS) {
    throw new Error(`d1_query_limit_exceeded:${sql.length}:${D1_MAX_ARTIFACT_STATEMENTS}`)
  }
  const oversized = sql.find((statement) => Buffer.byteLength(statement, 'utf8') > 100_000)
  if (oversized) throw new Error('d1_statement_limit_exceeded')
  return { sql, mappings, before }
}

export function verifyBackfill(db: Database.Database): BackfillSummary {
  const summary = inspectBackfill(db)
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error(`integrity_check_failed:${integrity.length}`)
  }
  const foreignKeys = db.pragma('foreign_key_check') as unknown[]
  if (foreignKeys.length > 0) throw new Error(`foreign_key_check_failed:${foreignKeys.length}`)
  if (summary.invalidIds > 0) throw new Error(`invalid_ids_remaining:${summary.invalidIds}`)
  if (summary.invalidTokens > 0) throw new Error(`invalid_tokens_remaining:${summary.invalidTokens}`)
  if (summary.ambiguousRedirectTokens > 0) {
    throw new Error(`ambiguous_redirect_tokens:${summary.ambiguousRedirectTokens}`)
  }
  return summary
}

export function applyBackfill(db: Database.Database, requestedPlan?: BackfillPlan): BackfillSummary {
  assertNotFinalized(db)
  const pendingDigest = pendingBackfillDigest(db)
  if (pendingDigest) {
    if (requestedPlan && backfillPlanDigest(requestedPlan) !== pendingDigest) {
      throw new Error(`id_backfill_different_artifact_pending:${pendingDigest}`)
    }
    return verifyBackfill(db)
  }
  const plan = requestedPlan ?? createBackfillPlan(db)
  const digest = backfillPlanDigest(plan)
  const rowCounts = preservedRowCounts(db)
  const run = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON')
    for (const statement of plan.sql) db.exec(statement)
    const summary = verifyBackfill(db)
    assertPreservedRowCounts(db, rowCounts)
    db.prepare('INSERT INTO system_options (key, value) VALUES (?, ?)').run(PENDING_DIGEST_KEY, digest)
    return summary
  })
  return run()
}

export function rollbackBackfill(db: Database.Database): BackfillSummary {
  assertNotFinalized(db)
  if (!tableExists(db, MAP_TABLE)) throw new Error('backfill_mapping_missing')
  const rowCounts = preservedRowCounts(db)
  const mappings = existingMappings(db).map((entry) => ({
    namespace: entry.namespace,
    oldValue: entry.newValue,
    newValue: entry.oldValue,
  }))
  const plan = { sql: updateSql(db, mappings), mappings, before: inspectBackfill(db) }
  plan.sql.splice(1, 0, `DROP TABLE ${ident(MAP_TABLE)};`)
  const run = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON')
    for (const statement of plan.sql) db.exec(statement)
    db.exec(`DROP TABLE ${ident(MAP_TABLE)}`)
    const foreignKeys = db.pragma('foreign_key_check') as unknown[]
    if (foreignKeys.length > 0) throw new Error(`foreign_key_check_failed:${foreignKeys.length}`)
    assertPreservedRowCounts(db, rowCounts)
    db.prepare('DELETE FROM system_options WHERE key = ?').run(PENDING_DIGEST_KEY)
    return inspectBackfill(db)
  })
  return run()
}

export function finalizeBackfill(db: Database.Database): void {
  assertNotFinalized(db)
  if (!tableExists(db, 'system_options')) throw new Error('system_options_missing')
  const pendingDigest = pendingBackfillDigest(db)
  if (!pendingDigest || !/^[0-9a-f]{64}$/.test(pendingDigest)) throw new Error('id_backfill_pending_digest_missing')
  const run = db.transaction(() => {
    verifyBackfill(db)
    if (!tableExists(db, MAP_TABLE)) throw new Error('backfill_mapping_missing')
    db.prepare('INSERT INTO system_options (key, value) VALUES (?, ?)').run(COMPLETION_KEY, COMPLETION_VERSION)
    db.prepare('INSERT INTO system_options (key, value) VALUES (?, ?)').run(APPLIED_DIGEST_KEY, pendingDigest)
    db.prepare('DELETE FROM system_options WHERE key = ?').run(PENDING_DIGEST_KEY)
    db.exec(`DROP TABLE ${ident(MAP_TABLE)}`)
  })
  run()
}
