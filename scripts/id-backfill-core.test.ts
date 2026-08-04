import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { ID_NORMALIZATION_DATA_TABLES } from '../shared/id-normalization-inventory'
import { assertIdIntegrity } from '../server/db/id-integrity'
import { applyIdBackfillArtifact, type IdBackfillBatchArtifact } from '../workers/id-backfill'
import {
  applyBackfill,
  createBackfillPlan,
  finalizeBackfill,
  inspectBackfill,
  idBackfillDataTables,
  rollbackBackfill,
  verifyBackfill,
} from './id-backfill-core'

function sqliteD1(db: Database.Database): D1Database {
  const statement = (query: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(query, next),
    first: async <T>() => db.prepare(query).get(...values) as T | null,
    all: async <T>() => ({ results: db.prepare(query).all(...values) as T[] }),
    run: async () => db.prepare(query).run(...values),
    raw: async () => [],
  })
  return {
    prepare: (query: string) => statement(query),
    batch: async (statements: Array<{ run(): Promise<unknown> }>) =>
      db.transaction(() => statements.map((prepared) => prepared.run()))(),
  } as unknown as D1Database
}

async function artifact(statements: string[]): Promise<IdBackfillBatchArtifact> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(statements))),
  )
  return {
    version: 1,
    digest: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    statements,
  }
}

function fixture(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE organization (id TEXT PRIMARY KEY);
    CREATE TABLE user (id TEXT PRIMARY KEY);
    CREATE TABLE account (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user(id),
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at INTEGER,
      refresh_token_expires_at INTEGER,
      scope TEXT,
      password TEXT
    );
    CREATE TABLE storages (id TEXT PRIMARY KEY);
    CREATE TABLE matters (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organization(id),
      alias TEXT NOT NULL UNIQUE,
      storage_id TEXT NOT NULL REFERENCES storages(id),
      object TEXT NOT NULL
    );
    CREATE TABLE shares (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      matter_id TEXT NOT NULL REFERENCES matters(id),
      org_id TEXT NOT NULL REFERENCES organization(id),
      creator_id TEXT NOT NULL REFERENCES user(id)
    );
    CREATE TABLE image_hostings (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      org_id TEXT NOT NULL REFERENCES organization(id),
      storage_id TEXT NOT NULL REFERENCES storages(id),
      storage_key TEXT NOT NULL
    );
    CREATE TABLE redirect_token_registry (
      token TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      resource_id TEXT NOT NULL
    );
    CREATE UNIQUE INDEX redirect_token_registry_kind_resource_id_unique
      ON redirect_token_registry(kind, resource_id);
    CREATE TABLE image_hosting_configs (
      org_id TEXT PRIMARY KEY REFERENCES organization(id),
      verification_token TEXT
    );
    CREATE TABLE team_invite_links (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ref_id TEXT, metadata TEXT);
    CREATE TABLE background_jobs (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL, metadata TEXT, result_metadata TEXT);
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY, event_key TEXT UNIQUE, org_id TEXT NOT NULL, user_id TEXT,
      actor_type TEXT, actor_ref TEXT, target_type TEXT NOT NULL, target_id TEXT, metadata TEXT
    );
    CREATE TABLE resource_changes (sequence INTEGER PRIMARY KEY AUTOINCREMENT, scope_id TEXT, resource_id TEXT, metadata TEXT);
    CREATE TABLE oauthResource (id TEXT PRIMARY KEY, identifier TEXT NOT NULL UNIQUE, signing_key_id TEXT);
    CREATE TABLE oauthClientResource (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, resource_id TEXT NOT NULL);
    CREATE TABLE x402_capacity_purchase_intents (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, resource_id TEXT NOT NULL);
    CREATE TABLE org_quota_entitlements (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, metadata TEXT);
    CREATE TABLE cloud_traffic_reports (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, storage_id TEXT, source TEXT NOT NULL, source_id TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE
    );
    CREATE TABLE storage_usage_ledger (
      id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, org_id TEXT NOT NULL, storage_id TEXT NOT NULL,
      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL
    );
    CREATE TABLE object_upload_sessions (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, object_id TEXT NOT NULL, storage_id TEXT NOT NULL, created_by TEXT NOT NULL
    );
    CREATE TABLE apikey (id TEXT PRIMARY KEY, reference_id TEXT NOT NULL, metadata TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT, token TEXT);
    CREATE TABLE oauthAccessToken (id TEXT PRIMARY KEY, user_id TEXT, token TEXT);
    CREATE TABLE jwks (id TEXT PRIMARY KEY);
    CREATE TABLE downloaders (id TEXT PRIMARY KEY, token_jti TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL, status TEXT NOT NULL);
    CREATE TABLE license_bindings (
      id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, status TEXT NOT NULL, refresh_token TEXT,
      cached_certificate TEXT, cached_certificate_expires_at INTEGER
    );
    CREATE TABLE system_options (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    INSERT INTO organization VALUES ('_org');
    INSERT INTO user VALUES ('user-');
    INSERT INTO account VALUES ('socialAccount', 'user-', 'access', 'refresh', 'identity', 1, 2, 'openid', NULL);
    INSERT INTO storages VALUES ('sto-rage');
    INSERT INTO matters VALUES ('matter-', '_org', 'alias_', 'sto-rage', 'objects/matter-/file.bin');
  `)
  db.exec(`
    INSERT INTO shares VALUES ('share_', 'ds_legacy', 'direct', 'active', 'matter-', '_org', 'user-');
    INSERT INTO image_hostings VALUES ('share_', '_org', 'active', '_org', 'sto-rage', 'ih/_org/_image.png');
    INSERT INTO image_hosting_configs VALUES ('_org', 'verify_token');
    INSERT INTO team_invite_links VALUES ('InviteBase62', 'AlreadyBase62');
    INSERT INTO notifications VALUES ('notice-', 'user-', 'share_', '{"shareId":"share_","jobId":"job_","token":"ds_legacy","nested":{"matterId":"matter-"}}');
    INSERT INTO background_jobs VALUES ('job_', '_org', 'user-', '{"matterIds":["matter-"],"jobId":"job_"}', '{"matterIds":["matter-"]}');
    INSERT INTO audit_events VALUES ('event:user_register:user-', NULL, '_org', 'user-', 'user', NULL, 'user', 'user-', '{"storageId":"sto-rage","sessionId":"session_upload_","sourceId":"share_","entitlementId":"entitlement_","externalId":"sto-rage"}');
    INSERT INTO resource_changes(scope_id, resource_id, metadata) VALUES ('_org', 'share_', '{"userId":"user-"}');
    INSERT INTO apikey VALUES ('api_key', 'user-', '{"workspaceId":"_org"}');
    INSERT INTO oauthResource VALUES ('oauthResource1', '_org', 'jwk_bad');
    INSERT INTO oauthClientResource VALUES ('client::resource', 'external-client', '_org');
    INSERT INTO x402_capacity_purchase_intents VALUES ('intent_', '_org', '_org');
    INSERT INTO org_quota_entitlements VALUES ('entitlement_', '_org', '{"grantedBy":"user-","updatedBy":"user-","revokedBy":"user-"}');
    INSERT INTO cloud_traffic_reports VALUES ('traffic-row_', '_org', 'sto-rage', 'direct_share', 'share_', 'external-event');
    INSERT INTO cloud_traffic_reports VALUES ('TrafficWebdav', '_org', 'sto-rage', 'webdav_download', 'matter-', 'external-webdav');
    INSERT INTO cloud_traffic_reports VALUES ('TrafficImage', '_org', 'sto-rage', 'custom_domain_image', 'share_', 'external-image');
    INSERT INTO storage_usage_ledger VALUES ('opening:_org:sto-rage', 'opening:_org:sto-rage', '_org', 'sto-rage', 'storage', 'sto-rage');
    INSERT INTO object_upload_sessions VALUES ('session_upload_', '_org', 'matter-', 'sto-rage', 'downloader:down_loader');
    INSERT INTO session VALUES ('session_bad', 'user-', 'session-token');
    INSERT INTO oauthAccessToken VALUES ('access_bad', 'user-', 'oauth-token');
    INSERT INTO jwks VALUES ('jwk_bad');
    INSERT INTO downloaders VALUES ('down_loader', 'jti_bad', 1, 'online');
    INSERT INTO license_bindings VALUES ('binding_', 'instance_bad', 'active', 'secret', 'certificate', 99);
    INSERT INTO license_bindings VALUES ('BindingBase62', 'InstanceBase62', 'disconnected', 'stale-secret', 'stale-certificate', 100);
    INSERT INTO system_options VALUES ('instance_id', 'instance_bad');
  `)
  return db
}

describe('ID backfill', () => {
  it('shares the complete touched-table inventory with the fresh-database guard', () => {
    expect(idBackfillDataTables()).toEqual([...ID_NORMALIZATION_DATA_TABLES].sort())
  })

  it('dry-runs without mutation and emits D1-sized, idempotent SQL', () => {
    const db = fixture()
    const plan = createBackfillPlan(db)
    expect(plan.before).toMatchObject({
      invalidIds: 18,
      invalidTokens: 6,
      credentialsToInvalidate: 7,
      ambiguousRedirectTokens: 0,
    })
    expect(plan.sql.every((statement) => Buffer.byteLength(statement) <= 100_000)).toBe(true)
    expect(plan.sql.length).toBeLessThanOrEqual(47)
    expect((db.prepare('SELECT id FROM organization').get() as { id: string }).id).toBe('_org')
    db.close()
  })

  it('rewrites PK/FK, polymorphic and JSON references and invalidates credentials', () => {
    const db = fixture()
    const objectKeys = {
      object: (db.prepare('SELECT object FROM matters').get() as { object: string }).object,
      storageKey: (db.prepare('SELECT storage_key AS storageKey FROM image_hostings').get() as { storageKey: string })
        .storageKey,
    }
    const beforeCounts = {
      matters: (db.prepare('SELECT COUNT(*) count FROM matters').get() as { count: number }).count,
      shares: (db.prepare('SELECT COUNT(*) count FROM shares').get() as { count: number }).count,
    }
    const after = applyBackfill(db)
    expect(after).toMatchObject({ invalidIds: 0, invalidTokens: 0, credentialsToInvalidate: 0 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.prepare('SELECT COUNT(*) count FROM session').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) count FROM oauthAccessToken').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) count FROM jwks').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT signing_key_id FROM oauthResource').get()).toEqual({ signing_key_id: null })
    expect(db.prepare('SELECT access_token, refresh_token, id_token, scope FROM account').get()).toEqual({
      access_token: null,
      refresh_token: null,
      id_token: null,
      scope: null,
    })
    expect(db.prepare('SELECT enabled, status FROM downloaders').get()).toEqual({ enabled: 0, status: 'offline' })
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM license_bindings WHERE status != \'disconnected\' OR refresh_token IS NOT NULL OR cached_certificate IS NOT NULL OR cached_certificate_expires_at IS NOT NULL').get(),
    ).toEqual({ count: 0 })
    expect((db.prepare('SELECT instance_id FROM license_bindings').get() as { instance_id: string }).instance_id).toMatch(
      /^[A-Za-z0-9]+$/,
    )
    expect(db.prepare('SELECT COUNT(*) count FROM matters').get()).toEqual({ count: beforeCounts.matters })
    expect(db.prepare('SELECT COUNT(*) count FROM shares').get()).toEqual({ count: beforeCounts.shares })
    expect(db.prepare('SELECT object FROM matters').get()).toEqual({ object: objectKeys.object })
    expect(db.prepare('SELECT storage_key AS storageKey FROM image_hostings').get()).toEqual({
      storageKey: objectKeys.storageKey,
    })

    const share = db.prepare('SELECT id, token, matter_id, org_id, creator_id FROM shares').get() as Record<string, string>
    expect(Object.values(share).every((value) => /^[A-Za-z0-9]+$/.test(value))).toBe(true)
    expect((db.prepare('SELECT token FROM image_hostings').get() as { token: string }).token).not.toBe(share.token)
    expect(db.prepare('SELECT kind, resource_id FROM redirect_token_registry ORDER BY kind').all()).toEqual([
      { kind: 'direct_share', resource_id: share.id },
      { kind: 'image_hosting', resource_id: (db.prepare('SELECT id FROM image_hostings').get() as { id: string }).id },
    ])
    const rotatedValidToken = (db.prepare('SELECT token FROM team_invite_links').get() as { token: string }).token
    expect(rotatedValidToken).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(rotatedValidToken).not.toBe('AlreadyBase62')
    const metadata = JSON.parse((db.prepare('SELECT metadata FROM notifications').get() as { metadata: string }).metadata)
    expect(metadata.shareId).toBe(share.id)
    expect(metadata.nested.matterId).toBe(share.matter_id)
    expect(metadata.token).toBe(share.token)
    const job = db.prepare('SELECT id, metadata, result_metadata FROM background_jobs').get() as Record<string, string>
    expect(JSON.parse(job.metadata)).toEqual({ matterIds: [share.matter_id], jobId: job.id })
    expect(JSON.parse(job.result_metadata)).toEqual({ matterIds: [share.matter_id] })
    expect((db.prepare('SELECT event_key FROM audit_events').get() as { event_key: string }).event_key).toBe(
      `event:user_register:${share.creator_id}`,
    )
    const auditMetadata = JSON.parse((db.prepare('SELECT metadata FROM audit_events').get() as { metadata: string }).metadata)
    expect(auditMetadata.storageId).toBe(
      (db.prepare('SELECT storage_id FROM matters').get() as { storage_id: string }).storage_id,
    )
    expect(auditMetadata.externalId).toBe('sto-rage')
    expect(auditMetadata.sessionId).toBe(
      (db.prepare('SELECT id FROM object_upload_sessions').get() as { id: string }).id,
    )
    expect(auditMetadata.sourceId).toBe(share.id)
    const entitlement = db.prepare('SELECT id, metadata FROM org_quota_entitlements').get() as { id: string; metadata: string }
    expect(auditMetadata.entitlementId).toBe(entitlement.id)
    expect(Object.values(JSON.parse(entitlement.metadata)).every((value) => value === share.creator_id)).toBe(true)
    expect((db.prepare('SELECT resource_id FROM oauthClientResource').get() as { resource_id: string }).resource_id).toBe('_org')
    expect((db.prepare('SELECT resource_id FROM x402_capacity_purchase_intents').get() as { resource_id: string }).resource_id).toBe('_org')
    expect((db.prepare("SELECT source_id FROM cloud_traffic_reports WHERE source = 'direct_share'").get() as { source_id: string }).source_id).toBe(share.id)
    expect((db.prepare("SELECT source_id FROM cloud_traffic_reports WHERE source = 'webdav_download'").get() as { source_id: string }).source_id).toBe(share.matter_id)
    expect((db.prepare("SELECT source_id FROM cloud_traffic_reports WHERE source = 'custom_domain_image'").get() as { source_id: string }).source_id).toBe(
      (db.prepare('SELECT id FROM image_hostings').get() as { id: string }).id,
    )
    const ledger = db.prepare('SELECT event_key, org_id, storage_id, resource_id FROM storage_usage_ledger').get() as Record<string, string>
    expect(Object.values(ledger).every((value) => /^[A-Za-z0-9:]+$/.test(value))).toBe(true)
    expect(ledger.event_key).toBe(`opening:${ledger.org_id}:${ledger.storage_id}`)
    expect((db.prepare('SELECT created_by FROM object_upload_sessions').get() as { created_by: string }).created_by).toMatch(/^downloader:[A-Za-z0-9]+$/)
    expect(() => verifyBackfill(db)).not.toThrow()
    expect(db.prepare("SELECT value FROM system_options WHERE key = 'id_normalization_pending_artifact_digest'").get()).toMatchObject({
      value: expect.stringMatching(/^[0-9a-f]{64}$/),
    })

    const second = applyBackfill(db)
    expect(second).toMatchObject({ invalidIds: 0, invalidTokens: 0, credentialsToInvalidate: 0 })
    db.close()
  })

  it('executes the complete representative planner artifact through the maintenance executor', async () => {
    const db = fixture()
    const plan = createBackfillPlan(db)
    const batch = await artifact(plan.sql)

    await expect(applyIdBackfillArtifact(sqliteD1(db), batch, batch.digest)).resolves.toEqual({
      statements: plan.sql.length,
      digest: batch.digest,
    })
    expect(verifyBackfill(db)).toMatchObject({ invalidIds: 0, invalidTokens: 0, credentialsToInvalidate: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM redirect_token_registry').get()).toEqual({ count: 2 })
    db.close()
  })

  it('rolls back mapped identifiers while keeping deliberately invalidated credentials absent', () => {
    const db = fixture()
    applyBackfill(db)
    const summary = rollbackBackfill(db)
    expect(summary.invalidIds).toBeGreaterThan(0)
    expect((db.prepare('SELECT id FROM organization').get() as { id: string }).id).toBe('_org')
    expect((db.prepare('SELECT token FROM shares').get() as { token: string }).token).toBe('ds_legacy')
    expect((db.prepare('SELECT token FROM team_invite_links').get() as { token: string }).token).toBe('AlreadyBase62')
    expect(db.prepare('SELECT token, kind FROM redirect_token_registry ORDER BY kind').all()).toEqual([
      { token: 'ds_legacy', kind: 'direct_share' },
      { token: '_org', kind: 'image_hosting' },
    ])
    expect((db.prepare('SELECT event_key FROM audit_events').get() as { event_key: string }).event_key).toBe(
      'event:user_register:user-',
    )
    expect(JSON.parse((db.prepare('SELECT metadata FROM notifications').get() as { metadata: string }).metadata)).toEqual({
      shareId: 'share_',
      jobId: 'job_',
      token: 'ds_legacy',
      nested: { matterId: 'matter-' },
    })
    expect(db.prepare('SELECT COUNT(*) count FROM session').get()).toEqual({ count: 0 })
    expect(
      db.prepare("SELECT value FROM system_options WHERE key = 'id_normalization_pending_artifact_digest'").get(),
    ).toBeUndefined()
    db.close()
  })

  it('rolls back an interrupted transaction completely', () => {
    const db = fixture()
    const plan = createBackfillPlan(db)
    const run = db.transaction(() => {
      db.pragma('defer_foreign_keys = ON')
      for (const statement of plan.sql.slice(0, Math.ceil(plan.sql.length / 2))) db.exec(statement)
      throw new Error('simulated interruption')
    })
    expect(run).toThrow('simulated interruption')
    expect((db.prepare('SELECT id FROM organization').get() as { id: string }).id).toBe('_org')
    expect(inspectBackfill(db).invalidIds).toBeGreaterThan(0)
    db.close()
  })

  it('handles an empty migrated database', () => {
    const db = new Database(':memory:')
    migrate(drizzle(db), { migrationsFolder: 'migrations' })
    const plan = createBackfillPlan(db)
    expect(plan.sql.length).toBeLessThanOrEqual(47)
    expect(applyBackfill(db, plan)).toMatchObject({ invalidIds: 0, invalidTokens: 0 })
    db.close()
  })

  it('coalesces a large set of JSON rewrites within the D1 free-plan query budget', () => {
    const db = fixture()
    const baselineDocuments = inspectBackfill(db).jsonDocumentsToRewrite
    const insert = db.prepare('INSERT INTO notifications VALUES (?, ?, ?, ?)')
    db.transaction(() => {
      for (let index = 0; index < 1_000; index += 1) {
        insert.run(`Notice${index}`, 'user-', 'share_', '{"shareId":"share_","matterId":"matter-"}')
      }
    })()

    expect(inspectBackfill(db).jsonDocumentsToRewrite).toBe(baselineDocuments + 1_000)
    const plan = createBackfillPlan(db)
    expect(plan.sql.length).toBeLessThanOrEqual(47)
    applyBackfill(db, plan)
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE instr(metadata, \'"share_"\') > 0').get(),
    ).toEqual({ count: 0 })
    db.close()
  })

  it('fails before mutation when a snapshot cannot fit the atomic D1 plan', () => {
    const db = fixture()
    const beforeCount = (
      db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE id LIKE 'notice-%'").get() as { count: number }
    ).count
    const insert = db.prepare('INSERT INTO notifications VALUES (?, ?, NULL, NULL)')
    db.transaction(() => {
      for (let index = 0; index < 24_000; index += 1) insert.run(`notice-${index}`, 'user-')
    })()

    expect(() => createBackfillPlan(db)).toThrow(/d1_query_limit_exceeded:\d+:47/)
    expect(db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE id LIKE 'notice-%'").get()).toEqual({
      count: beforeCount + 24_000,
    })
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = '_zpan_id_backfill_map'").get()).toBeUndefined()
    db.close()
  })

  it('transitions the pending digest to completion and applied-digest markers', () => {
    const db = fixture()
    applyBackfill(db)
    const pending = db
      .prepare("SELECT value FROM system_options WHERE key = 'id_normalization_pending_artifact_digest'")
      .get() as { value: string }
    finalizeBackfill(db)
    expect(db.prepare("SELECT value FROM system_options WHERE key = 'id_normalization_version'").get()).toEqual({
      value: '1',
    })
    expect(db.prepare("SELECT value FROM system_options WHERE key = 'id_normalization_applied_artifact_digest'").get()).toEqual({
      value: pending.value,
    })
    expect(
      db.prepare("SELECT value FROM system_options WHERE key = 'id_normalization_pending_artifact_digest'").get(),
    ).toBeUndefined()
    expect(() => createBackfillPlan(db)).toThrow('id_backfill_already_finalized:1')
    expect(() => finalizeBackfill(db)).toThrow('id_backfill_already_finalized:1')
    db.close()
  })

  it('allows runtime bootstrap during the local observation window', async () => {
    const sqlite = new Database(':memory:')
    migrate(drizzle(sqlite), { migrationsFolder: 'migrations' })
    sqlite.exec(`
      INSERT INTO organization (id, name, slug, created_at) VALUES ('legacy_org', 'Legacy', 'legacy', 1);
    `)
    applyBackfill(sqlite)

    await expect(assertIdIntegrity(drizzle(sqlite))).resolves.toBeUndefined()
    sqlite.close()
  })
})
