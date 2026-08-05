import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { buildD1ApplySql, normalizeDatabase, runNormalizationCli } from '../../scripts/normalize-ids'
import { BASE62_PATTERN, IMAGE_TOKEN_PATTERN, SHARE_TOKEN_PATTERN } from '../../shared/ids'

function fixture(path = ':memory:'): Database.Database {
  const db = new Database(path)
  db.pragma('foreign_keys = OFF')
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY);
    CREATE TABLE organization (id TEXT PRIMARY KEY);
    CREATE TABLE storages (id TEXT PRIMARY KEY, org_id TEXT);
    CREATE TABLE matters (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      alias TEXT NOT NULL UNIQUE,
      storage_id TEXT NOT NULL,
      parent TEXT NOT NULL DEFAULT '',
      object TEXT NOT NULL
    );
    CREATE TABLE shares (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      matter_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      creator_id TEXT NOT NULL
    );
    CREATE TABLE share_recipients (id TEXT PRIMARY KEY, share_id TEXT, recipient_user_id TEXT);
    CREATE TABLE image_hostings (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      org_id TEXT NOT NULL,
      storage_id TEXT NOT NULL,
      storage_key TEXT NOT NULL
    );
    CREATE TABLE image_hosting_configs (org_id TEXT PRIMARY KEY, verification_token TEXT);
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      event_key TEXT UNIQUE,
      org_id TEXT NOT NULL,
      user_id TEXT,
      target_type TEXT NOT NULL,
      target_id TEXT,
      actor_type TEXT,
      actor_ref TEXT,
      metadata TEXT
    );
    CREATE TABLE resource_changes (
      sequence INTEGER PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      metadata TEXT
    );
    CREATE TABLE storage_usage_ledger (
      id TEXT PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      org_id TEXT NOT NULL,
      storage_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL
    );
    CREATE TABLE cloud_traffic_reports (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      storage_id TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE org_quota_entitlements (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      metadata TEXT
    );
    CREATE TABLE download_tasks (id TEXT PRIMARY KEY, events TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed');
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ref_type TEXT, ref_id TEXT, metadata TEXT
    );
    CREATE TABLE apikey (id TEXT PRIMARY KEY, reference_id TEXT, key TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL);
    CREATE TABLE verification (id TEXT PRIMARY KEY);
    CREATE TABLE deviceCode (id TEXT PRIMARY KEY);
    CREATE TABLE oauthAccessToken (id TEXT PRIMARY KEY);
    CREATE TABLE oauthRefreshToken (id TEXT PRIMARY KEY);
    CREATE TABLE oauthPushedAuthorizationRequest (id TEXT PRIMARY KEY);
    CREATE TABLE oauthClientAssertion (id TEXT PRIMARY KEY);
    CREATE TABLE oauthClient (id TEXT PRIMARY KEY, client_id TEXT UNIQUE, user_id TEXT);
    CREATE TABLE oauthResource (id TEXT PRIMARY KEY, identifier TEXT UNIQUE);
    CREATE TABLE oauthClientResource (id TEXT PRIMARY KEY, client_id TEXT, resource_id TEXT);
    CREATE TABLE oauthConsent (id TEXT PRIMARY KEY, client_id TEXT, user_id TEXT, authorization_details TEXT);
    CREATE TABLE oauthClientRegistration (client_id TEXT PRIMARY KEY);
    CREATE TABLE jwks (id TEXT PRIMARY KEY);
    CREATE TABLE downloader_bootstrap_credentials (id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT);
    CREATE TABLE downloaders (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, token_jti TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL
    );
    CREATE TABLE object_upload_sessions (
      id TEXT PRIMARY KEY, created_by TEXT, status TEXT NOT NULL DEFAULT 'completed'
    );

    INSERT INTO user VALUES ('user-_legacy');
    INSERT INTO organization VALUES ('-org_legacy-');
    INSERT INTO storages VALUES ('user-_legacy', '-org_legacy-');
    INSERT INTO matters VALUES (
      'matter_old-', '-org_legacy-', '_alias-', 'user-_legacy', '',
      'objects/-org_legacy-/matter_old-'
    );
    INSERT INTO shares VALUES ('share_old-', 'ds_direct-old', 'matter_old-', '-org_legacy-', 'user-_legacy');
    INSERT INTO share_recipients VALUES ('recipient_old-', 'share_old-', 'user-_legacy');
    INSERT INTO image_hostings VALUES (
      'image_old-', 'ds_direct-old', '-org_legacy-', 'user-_legacy',
      'ih/-org_legacy-/image_old-.png'
    );
    INSERT INTO image_hosting_configs VALUES ('-org_legacy-', 'verify_old-');
    INSERT INTO audit_events VALUES (
      'event:download_issued:matter_old-', NULL, '-org_legacy-', 'user-_legacy',
      'file', 'matter_old-', 'user', 'user-_legacy',
      '{"matterId":"matter_old-","storageId":"user-_legacy","nested":{"orgId":"-org_legacy-"},"sessionId":"upload_old-","sourceId":"matter_old-","customerId":"user-_legacy","eventId":"matter_old-"}'
    );
    INSERT INTO resource_changes VALUES (
      1, 'organization', '-org_legacy-', 'share', 'share_old-',
      '{"userId":"user-_legacy","storageId":"user-_legacy"}'
    );
    INSERT INTO storage_usage_ledger VALUES (
      'opening:-org_legacy-:user-_legacy', 'opening:-org_legacy-:user-_legacy',
      '-org_legacy-', 'user-_legacy', 'storage', 'user-_legacy'
    );
    INSERT INTO cloud_traffic_reports VALUES (
      'traffic_row-', '-org_legacy-', 'direct_share', 'share_old-', 'traffic_share_old-', 'user-_legacy', 'reported'
    );
    INSERT INTO org_quota_entitlements VALUES (
      'quota_row-', '-org_legacy-', 'free_plan', 'free_plan:-org_legacy-',
      '{"targetOrgId":"-org_legacy-","grantedBy":"user-_legacy","cloudOrderId":"user-_legacy"}'
    );
    INSERT INTO download_tasks VALUES (
      'task_old-', '[{"id":"initial:task_old-","type":"status_changed"}]', 'completed'
    );
    INSERT INTO notifications VALUES (
      'notification_old-', 'user-_legacy', 'share', 'share_old-',
      '{"shareId":"share_old-","token":"ds_direct-old","customerId":"user-_legacy"}'
    );
    INSERT INTO apikey VALUES ('api_key_old-', 'user-_legacy', 'irreversible-hash');
    INSERT INTO session VALUES ('session_old-', 'user-_legacy', 'session-token');
    INSERT INTO verification VALUES ('verification_old-');
    INSERT INTO deviceCode VALUES ('device_old-');
    INSERT INTO oauthAccessToken VALUES ('access_old-');
    INSERT INTO oauthRefreshToken VALUES ('refresh_old-');
    INSERT INTO oauthPushedAuthorizationRequest VALUES ('par_old-');
    INSERT INTO oauthClientAssertion VALUES ('assertion-old');
    INSERT INTO oauthClient VALUES ('dynamic_client-', 'dynamic-client', 'user-_legacy');
    INSERT INTO oauthClient VALUES ('static_client-', 'static-client', 'user-_legacy');
    INSERT INTO oauthResource VALUES ('oauth_resource-', 'zpan-api');
    INSERT INTO oauthClientResource VALUES ('dynamic_link-', 'dynamic-client', 'zpan-api');
    INSERT INTO oauthClientResource VALUES ('static_link-', 'static-client', 'zpan-api');
    INSERT INTO oauthConsent VALUES (
      'consent_old-', 'static-client', 'user-_legacy',
      '[{"type":"zpan_workspace","identifier":"-org_legacy-"}]'
    );
    INSERT INTO oauthClientRegistration VALUES ('dynamic-client');
    INSERT INTO jwks VALUES ('protocol-key-id');
    INSERT INTO downloader_bootstrap_credentials VALUES ('bootstrap_old-', 'user-_legacy', 'bootstrap-hash');
    INSERT INTO downloaders VALUES ('downloader_old-', 'legacy-hash', 'legacy-jti', 1);
    INSERT INTO downloaders VALUES ('SafeDownloader123', 'safe-legacy-hash', 'safe-legacy-jti', 1);
    INSERT INTO object_upload_sessions VALUES ('upload_old-', 'downloader:downloader_old-', 'completed');
    INSERT INTO object_upload_sessions VALUES ('user_upload_old-', 'user-_legacy', 'completed');
  `)
  return db
}

function value(db: Database.Database, sql: string): string {
  return (db.prepare(sql).get() as { value: string }).value
}

describe('ID normalization backfill', () => {
  it('dry-runs without changing the source database', () => {
    const db = fixture()
    const summary = normalizeDatabase(db, false)

    expect(summary.apply).toBe(false)
    expect(summary.mappings.user).toBe(1)
    expect(summary.invalidated.session).toBe(1)
    expect(value(db, 'SELECT id AS value FROM user')).toBe('user-_legacy')
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_zpan_id_normalization_map'").get()).toBeUndefined()
    db.close()
  })

  it('atomically maps IDs and references, rotates public tokens, rewrites JSON, and invalidates credentials', () => {
    const db = fixture()
    const summary = normalizeDatabase(db, true)

    expect(summary.jsonDocumentsUpdated).toBeGreaterThan(0)
    const userId = value(db, 'SELECT id AS value FROM user')
    const orgId = value(db, 'SELECT id AS value FROM organization')
    const storageId = value(db, 'SELECT id AS value FROM storages')
    const matterId = value(db, 'SELECT id AS value FROM matters')
    const shareId = value(db, 'SELECT id AS value FROM shares')
    const shareToken = value(db, 'SELECT token AS value FROM shares')
    const imageToken = value(db, 'SELECT token AS value FROM image_hostings')
    const taskId = value(db, 'SELECT id AS value FROM download_tasks')
    const downloaderId = value(
      db,
      "SELECT substr(created_by, 12) AS value FROM object_upload_sessions WHERE created_by LIKE 'downloader:%'",
    )
    const uploadSessionId = value(
      db,
      "SELECT id AS value FROM object_upload_sessions WHERE created_by LIKE 'downloader:%'",
    )

    for (const governedValue of [
      userId,
      orgId,
      storageId,
      matterId,
      shareId,
      shareToken,
      imageToken,
      taskId,
      downloaderId,
    ]) {
      expect(governedValue).toMatch(BASE62_PATTERN)
    }
    expect(shareToken).toMatch(SHARE_TOKEN_PATTERN)
    expect(imageToken).toMatch(IMAGE_TOKEN_PATTERN)
    expect(shareToken).toHaveLength(12)
    expect(imageToken).toHaveLength(12)
    expect(shareToken).not.toBe(imageToken)
    expect(value(db, 'SELECT org_id AS value FROM matters')).toBe(orgId)
    expect(value(db, 'SELECT storage_id AS value FROM matters')).toBe(storageId)
    expect(value(db, 'SELECT matter_id AS value FROM shares')).toBe(matterId)
    expect(value(db, 'SELECT creator_id AS value FROM shares')).toBe(userId)
    expect(value(db, 'SELECT share_id AS value FROM share_recipients')).toBe(shareId)
    expect(value(db, 'SELECT target_id AS value FROM audit_events')).toBe(matterId)
    expect(value(db, 'SELECT actor_ref AS value FROM audit_events')).toBe(userId)
    expect(value(db, 'SELECT scope_id AS value FROM resource_changes')).toBe(orgId)
    expect(value(db, 'SELECT resource_id AS value FROM resource_changes')).toBe(shareId)
    expect(value(db, 'SELECT resource_id AS value FROM storage_usage_ledger')).toBe(storageId)
    expect(value(db, 'SELECT source_id AS value FROM cloud_traffic_reports')).toBe(shareId)
    expect(value(db, 'SELECT event_id AS value FROM cloud_traffic_reports')).toBe('traffic_share_old-')
    expect(value(db, 'SELECT source_id AS value FROM org_quota_entitlements')).toBe(`free_plan:${orgId}`)
    expect(value(db, 'SELECT ref_id AS value FROM notifications')).toBe(shareId)
    expect(value(db, 'SELECT created_by AS value FROM object_upload_sessions')).toBe(`downloader:${downloaderId}`)
    expect(
      value(db, "SELECT created_by AS value FROM object_upload_sessions WHERE created_by NOT LIKE 'downloader:%'"),
    ).toBe(userId)
    expect(summary.credentialsInvalidated.downloaders).toBe(2)
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM downloaders WHERE enabled = 0 AND token_hash = ?').get('') as {
          count: number
        }
      ).count,
    ).toBe(2)
    expect(
      (
        db.prepare("SELECT COUNT(*) AS count FROM downloaders WHERE token_jti GLOB '*[^A-Za-z0-9]*'").get() as {
          count: number
        }
      ).count,
    ).toBe(0)

    const metadata = JSON.parse(value(db, 'SELECT metadata AS value FROM audit_events')) as Record<string, unknown>
    expect(metadata).toMatchObject({ matterId, storageId, nested: { orgId } })
    expect(metadata).toMatchObject({ sessionId: uploadSessionId, sourceId: matterId })
    expect(metadata.customerId).toBe('user-_legacy')
    expect(metadata.eventId).toBe('matter_old-')
    expect(JSON.parse(value(db, 'SELECT metadata AS value FROM resource_changes'))).toEqual({ userId, storageId })
    expect(JSON.parse(value(db, 'SELECT events AS value FROM download_tasks'))).toMatchObject([
      { id: `initial:${taskId}` },
    ])
    expect(JSON.parse(value(db, 'SELECT metadata AS value FROM notifications'))).toMatchObject({
      shareId,
      token: shareToken,
      customerId: 'user-_legacy',
    })
    expect(JSON.parse(value(db, 'SELECT metadata AS value FROM org_quota_entitlements'))).toMatchObject({
      targetOrgId: orgId,
      grantedBy: userId,
      cloudOrderId: 'user-_legacy',
    })
    expect(value(db, 'SELECT event_key AS value FROM audit_events')).toContain(matterId)
    expect(value(db, 'SELECT event_key AS value FROM storage_usage_ledger')).toBe(`opening:${orgId}:${storageId}`)
    expect(value(db, 'SELECT id AS value FROM audit_events')).toMatch(BASE62_PATTERN)

    // Physical object keys are external storage references and intentionally do not change.
    expect(value(db, 'SELECT object AS value FROM matters')).toBe('objects/-org_legacy-/matter_old-')
    expect(value(db, 'SELECT storage_key AS value FROM image_hostings')).toBe('ih/-org_legacy-/image_old-.png')
    for (const table of [
      'session',
      'apikey',
      'verification',
      'deviceCode',
      'downloader_bootstrap_credentials',
      'oauthAccessToken',
      'oauthRefreshToken',
      'oauthPushedAuthorizationRequest',
      'oauthClientAssertion',
      'oauthConsent',
      'oauthClientRegistration',
      'jwks',
    ]) {
      expect((db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count).toBe(0)
    }
    expect(value(db, "SELECT client_id AS value FROM oauthClient WHERE client_id = 'static-client'")).toBe(
      'static-client',
    )
    expect(db.prepare("SELECT 1 FROM oauthClient WHERE client_id = 'dynamic-client'").get()).toBeUndefined()
    expect(db.prepare("SELECT 1 FROM oauthClientResource WHERE client_id = 'dynamic-client'").get()).toBeUndefined()
    expect(db.prepare("SELECT 1 FROM oauthClientResource WHERE client_id = 'static-client'").get()).toBeTruthy()
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it('is idempotent after a completed apply', () => {
    const db = fixture()
    normalizeDatabase(db, true)
    const firstUserId = value(db, 'SELECT id AS value FROM user')
    const second = normalizeDatabase(db, true)

    expect(Object.values(second.mappings).reduce((sum, count) => sum + count, 0)).toBe(0)
    expect(value(db, 'SELECT id AS value FROM user')).toBe(firstUserId)
    db.close()
  })

  it('treats a completed rerun as validation-only and preserves newly issued credentials', () => {
    const db = fixture()
    normalizeDatabase(db, true)
    const matterId = value(db, 'SELECT id AS value FROM matters')
    const orgId = value(db, 'SELECT id AS value FROM organization')
    const userId = value(db, 'SELECT id AS value FROM user')
    db.prepare('INSERT INTO shares VALUES (?, ?, ?, ?, ?)').run('NewShare123', 'sNewToken123', matterId, orgId, userId)
    db.prepare('INSERT INTO session VALUES (?, ?, ?)').run('NewSession123', userId, 'NewSessionToken123')

    const summary = normalizeDatabase(db, true)

    expect(value(db, "SELECT token AS value FROM shares WHERE id = 'NewShare123'")).toBe('sNewToken123')
    expect(value(db, "SELECT token AS value FROM session WHERE id = 'NewSession123'")).toBe('NewSessionToken123')
    expect(summary.invalidated).toEqual({})
    db.close()
  })

  it('accepts an active Cloud binding when every organization ID is already normalized', () => {
    const db = fixture()
    normalizeDatabase(db, true)
    db.exec(`
      CREATE TABLE license_bindings (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, status TEXT NOT NULL);
      INSERT INTO license_bindings VALUES ('Binding123', 'SafeInstance123', 'active');
    `)

    expect(() => normalizeDatabase(db, true)).not.toThrow()
    db.close()
  })

  it('rewrites typed ledger keys while preserving unknown polymorphic protocol values', () => {
    const db = fixture()
    db.exec(`
      INSERT INTO storage_usage_ledger VALUES (
        'matter_ledger-', 'matter:matter_old-', '-org_legacy-', 'user-_legacy', 'matter', 'matter_old-'
      );
      INSERT INTO storage_usage_ledger VALUES (
        'image_ledger-', 'image:image_old-', '-org_legacy-', 'user-_legacy', 'image_hosting', 'image_old-'
      );
      INSERT INTO resource_changes VALUES (
        2, 'protocol', 'urn:scope-with-punctuation', 'protocol', 'urn:resource-with-punctuation', '{}'
      );
    `)

    normalizeDatabase(db, true)

    const matterId = value(db, 'SELECT id AS value FROM matters')
    const imageId = value(db, 'SELECT id AS value FROM image_hostings')
    expect(value(db, "SELECT event_key AS value FROM storage_usage_ledger WHERE resource_type = 'matter'")).toBe(
      `matter:${matterId}`,
    )
    expect(value(db, "SELECT event_key AS value FROM storage_usage_ledger WHERE resource_type = 'image_hosting'")).toBe(
      `image:${imageId}`,
    )
    expect(value(db, 'SELECT scope_id AS value FROM resource_changes WHERE sequence = 2')).toBe(
      'urn:scope-with-punctuation',
    )
    expect(value(db, 'SELECT resource_id AS value FROM resource_changes WHERE sequence = 2')).toBe(
      'urn:resource-with-punctuation',
    )
    db.close()
  })

  it('rejects an empty required logical reference after completion', () => {
    const db = fixture()
    normalizeDatabase(db, true)
    db.exec("UPDATE shares SET matter_id = ''")

    expect(() => normalizeDatabase(db, true)).toThrow('invalid_value_remaining:shares.matter_id:1')
    db.close()
  })

  it('rejects a stale typed JSON reference after completion without mutating it', () => {
    const db = fixture()
    normalizeDatabase(db, true)
    db.exec(`UPDATE notifications SET metadata = '{"token":"ds_direct-old"}'`)

    expect(() => normalizeDatabase(db, true)).toThrow('stale_embedded_reference:polymorphic=0,json=1,structured=0')
    expect(value(db, 'SELECT metadata AS value FROM notifications')).toBe('{"token":"ds_direct-old"}')
    db.close()
  })

  it('rejects a Base62 direct reference whose target does not exist', () => {
    const db = fixture()
    normalizeDatabase(db, true)
    db.exec("UPDATE shares SET matter_id = 'MissingMatter123'")

    expect(() => normalizeDatabase(db, true)).toThrow('dangling_reference:shares.matter_id->matters.id:1')
    db.close()
  })

  it('rejects a Base62 typed JSON reference whose target does not exist', () => {
    const db = fixture()
    normalizeDatabase(db, true)
    db.exec(`UPDATE notifications SET metadata = '{"shareId":"MissingShare123"}'`)

    expect(() => normalizeDatabase(db, true)).toThrow('dangling_json_reference:notifications.metadata:1')
    db.close()
  })

  it.each([
    {
      name: 'a newly persisted invalid API-key row ID',
      mutate: (db: Database.Database) => db.exec("INSERT INTO apikey VALUES ('invalid-api-key', NULL, 'hash')"),
      error: 'invalid_value_remaining:apikey.id:1',
    },
    {
      name: 'an invalid known polymorphic reference',
      mutate: (db: Database.Database) => db.exec("UPDATE notifications SET ref_id = 'invalid-share'"),
      error: 'invalid_polymorphic_reference:notifications.ref_id:1',
    },
    {
      name: 'an invalid structured upload-session creator',
      mutate: (db: Database.Database) =>
        db.exec(
          "UPDATE object_upload_sessions SET created_by = 'downloader:invalid-id' WHERE id = (SELECT id FROM object_upload_sessions LIMIT 1)",
        ),
      error: 'invalid_structured_reference:object_upload_sessions.created_by:1',
    },
    {
      name: 'a share token with the image namespace prefix',
      mutate: (db: Database.Database) => db.exec("UPDATE shares SET token = 'i00000000000'"),
      error: 'invalid_value_remaining:shares.token:1',
    },
    {
      name: 'an image token with the share namespace prefix',
      mutate: (db: Database.Database) => db.exec("UPDATE image_hostings SET token = 's00000000000'"),
      error: 'invalid_value_remaining:image_hostings.token:1',
    },
  ])('rejects $name after completion', ({ mutate, error }) => {
    const db = fixture()
    normalizeDatabase(db, true)
    mutate(db)

    expect(() => normalizeDatabase(db, true)).toThrow(error)
    db.close()
  })

  it('replays the exact mapping as a D1-compatible SQL plan', () => {
    const planningCopy = fixture()
    normalizeDatabase(planningCopy, true)
    const expectedUserId = value(planningCopy, 'SELECT id AS value FROM user')
    const expectedShareToken = value(planningCopy, 'SELECT token AS value FROM shares')
    const plan = buildD1ApplySql(planningCopy)
    expect(plan).not.toContain('WHERE rowid')
    expect(plan).toContain('substr("token", 1, 1) != \'s\'')
    expect(plan).toContain('substr("token", 1, 1) != \'i\'')

    const d1Copy = fixture()
    d1Copy.exec(plan)
    expect(value(d1Copy, 'SELECT id AS value FROM user')).toBe(expectedUserId)
    expect(value(d1Copy, 'SELECT token AS value FROM shares')).toBe(expectedShareToken)
    expect(value(d1Copy, 'SELECT matter_id AS value FROM shares')).toBe(
      value(planningCopy, 'SELECT matter_id AS value FROM shares'),
    )
    expect(JSON.parse(value(d1Copy, 'SELECT metadata AS value FROM audit_events'))).toEqual(
      JSON.parse(value(planningCopy, 'SELECT metadata AS value FROM audit_events')),
    )
    expect(value(d1Copy, 'SELECT target_id AS value FROM audit_events')).toBe(
      value(planningCopy, 'SELECT target_id AS value FROM audit_events'),
    )
    expect(value(d1Copy, 'SELECT resource_id AS value FROM resource_changes')).toBe(
      value(planningCopy, 'SELECT resource_id AS value FROM resource_changes'),
    )
    expect(value(d1Copy, 'SELECT event_key AS value FROM storage_usage_ledger')).toBe(
      value(planningCopy, 'SELECT event_key AS value FROM storage_usage_ledger'),
    )
    expect(value(d1Copy, 'SELECT source_id AS value FROM cloud_traffic_reports')).toBe(
      value(planningCopy, 'SELECT source_id AS value FROM cloud_traffic_reports'),
    )
    expect(value(d1Copy, 'SELECT ref_id AS value FROM notifications')).toBe(
      value(planningCopy, 'SELECT ref_id AS value FROM notifications'),
    )
    expect(value(d1Copy, 'SELECT events AS value FROM download_tasks')).toBe(
      value(planningCopy, 'SELECT events AS value FROM download_tasks'),
    )
    expect((d1Copy.prepare('SELECT COUNT(*) AS count FROM session').get() as { count: number }).count).toBe(0)
    expect(d1Copy.prepare("SELECT 1 FROM oauthClient WHERE client_id = 'dynamic-client'").get()).toBeUndefined()
    expect(d1Copy.prepare("SELECT 1 FROM oauthClient WHERE client_id = 'static-client'").get()).toBeTruthy()
    expect(
      (
        d1Copy.prepare("SELECT COUNT(*) AS count FROM downloaders WHERE enabled = 0 AND token_hash = ''").get() as {
          count: number
        }
      ).count,
    ).toBe(2)
    expect(
      value(d1Copy, "SELECT created_by AS value FROM object_upload_sessions WHERE created_by NOT LIKE 'downloader:%'"),
    ).toBe(value(planningCopy, 'SELECT id AS value FROM user'))
    expect(d1Copy.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    const migratedUserId = value(d1Copy, 'SELECT id AS value FROM user')
    d1Copy.prepare('INSERT INTO session VALUES (?, ?, ?)').run('NewSession123', migratedUserId, 'NewToken123')
    d1Copy.exec(`UPDATE notifications SET metadata = '{"fresh":true}'`)
    d1Copy.exec(plan)
    expect(value(d1Copy, "SELECT token AS value FROM session WHERE id = 'NewSession123'")).toBe('NewToken123')
    expect(value(d1Copy, 'SELECT metadata AS value FROM notifications')).toBe('{"fresh":true}')
    planningCopy.close()
    d1Copy.close()
  })

  it('chunks large reviewed mappings below the D1 statement limit', () => {
    const db = fixture()
    const insert = db.prepare('INSERT INTO user (id) VALUES (?)')
    db.transaction(() => {
      for (let index = 0; index < 2_400; index += 1) insert.run(`legacy-user-${index}`)
    })()

    normalizeDatabase(db, true)
    const plan = buildD1ApplySql(db)

    expect(plan.match(/INSERT INTO _zpan_id_normalization_map/g)?.length).toBeGreaterThan(1)
    expect(plan.match(/reviewed-mapping:\d+/g)?.length).toBeGreaterThan(1)
    db.close()
  })

  it('fails before emitting a D1 statement with an oversized rewritten JSON document', () => {
    const db = fixture()
    db.prepare('UPDATE notifications SET metadata = ?').run(
      JSON.stringify({ shareId: 'share_old-', padding: 'x'.repeat(100_000) }),
    )

    normalizeDatabase(db, true)
    expect(() => buildD1ApplySql(db)).toThrow('d1_plan_statement_limit_exceeded')
    db.close()
  })

  it('fails before emitting more commands than one D1 invocation can execute', () => {
    const db = fixture()
    const insert = db.prepare(
      "INSERT INTO notifications (id, user_id, ref_type, ref_id, metadata) VALUES (?, 'user-_legacy', 'share', 'share_old-', ?)",
    )
    db.transaction(() => {
      for (let index = 0; index < 600; index += 1) {
        insert.run(`SafeNotification${index}`, JSON.stringify({ shareId: 'share_old-' }))
      }
    })()

    normalizeDatabase(db, true)
    expect(() => buildD1ApplySql(db)).toThrow('d1_plan_command_limit_exceeded')
    db.close()
  })

  it('recovers by replaying the full D1 plan after an interrupted prefix', () => {
    const planningCopy = fixture()
    normalizeDatabase(planningCopy, true)
    const plan = buildD1ApplySql(planningCopy)
    const statements = plan
      .replace(/^--.*$/gm, '')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)
    const d1Copy = fixture()

    d1Copy.exec(`${statements.slice(0, Math.floor(statements.length / 2)).join(';\n')};`)
    d1Copy.exec(plan)

    expect(value(d1Copy, 'SELECT id AS value FROM user')).toBe(value(planningCopy, 'SELECT id AS value FROM user'))
    expect(value(d1Copy, 'SELECT token AS value FROM shares')).toBe(
      value(planningCopy, 'SELECT token AS value FROM shares'),
    )
    expect(d1Copy.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    planningCopy.close()
    d1Copy.close()
  })

  it('does not write the D1 completion marker when a mapped update silently misses its source row', () => {
    const planningCopy = fixture()
    normalizeDatabase(planningCopy, true)
    const plan = buildD1ApplySql(planningCopy)
    const d1Copy = fixture()
    d1Copy.exec("UPDATE shares SET matter_id = 'UnrelatedBase62Matter'")

    expect(() => d1Copy.exec(plan)).toThrow()
    const stateExists = Boolean(
      d1Copy
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_zpan_id_normalization_state'")
        .get(),
    )
    expect(
      stateExists
        ? d1Copy.prepare("SELECT 1 FROM _zpan_id_normalization_state WHERE key = 'completed_at'").get()
        : undefined,
    ).toBeUndefined()
    planningCopy.close()
    d1Copy.close()
  })

  it('refuses to bless a pre-existing unversioned D1 completion marker', () => {
    const planningCopy = fixture()
    normalizeDatabase(planningCopy, true)
    const plan = buildD1ApplySql(planningCopy)
    const d1Copy = fixture()
    d1Copy.exec(`
      CREATE TABLE _zpan_id_normalization_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _zpan_id_normalization_state VALUES ('completed_at', 'unverified');
    `)

    expect(() => d1Copy.exec(plan)).toThrow()
    expect(
      d1Copy.prepare("SELECT 1 FROM _zpan_id_normalization_state WHERE key = 'validation_version'").get(),
    ).toBeUndefined()
    planningCopy.close()
    d1Copy.close()
  })

  it('rejects a conflicting pre-existing D1 mapping instead of using an unreviewed target', () => {
    const planningCopy = fixture()
    normalizeDatabase(planningCopy, true)
    const plan = buildD1ApplySql(planningCopy)
    const d1Copy = fixture()
    d1Copy.exec(`
      CREATE TABLE _zpan_id_normalization_map (
        kind TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (kind, old_value), UNIQUE (kind, new_value)
      );
      INSERT INTO _zpan_id_normalization_map VALUES ('share_token', 'ds_direct-old', 'sDifferent01', 0);
    `)

    expect(() => d1Copy.exec(plan)).toThrow()
    expect(
      d1Copy.prepare("SELECT 1 FROM _zpan_id_normalization_state WHERE key = 'completed_at'").get(),
    ).toBeUndefined()
    planningCopy.close()
    d1Copy.close()
  })

  it('rejects a missed rotation of an already-Base62 public token', () => {
    const planningCopy = fixture()
    planningCopy.exec(`
      UPDATE shares SET token = 'AlreadyBase62Token';
      UPDATE notifications SET metadata = '{"shareId":"share_old-","token":"AlreadyBase62Token","customerId":"user-_legacy"}';
    `)
    normalizeDatabase(planningCopy, true)
    const plan = buildD1ApplySql(planningCopy)
    const d1Copy = fixture()
    d1Copy.exec("UPDATE shares SET token = 'DriftedBase62Token'")

    expect(() => d1Copy.exec(plan)).toThrow()
    expect(
      d1Copy.prepare("SELECT 1 FROM _zpan_id_normalization_state WHERE key = 'completed_at'").get(),
    ).toBeUndefined()
    planningCopy.close()
    d1Copy.close()
  })

  it('rejects a dangling typed JSON reference that drifted after the reviewed export', () => {
    const prepareStableReference = (db: Database.Database) => {
      db.exec(`
        INSERT INTO shares VALUES (
          'SafeShare123', 'SafeToken123', 'matter_old-', '-org_legacy-', 'user-_legacy'
        );
        INSERT INTO notifications VALUES (
          'SafeNotification123', 'user-_legacy', NULL, NULL, '{"shareId":"SafeShare123"}'
        );
      `)
    }
    const planningCopy = fixture()
    prepareStableReference(planningCopy)
    normalizeDatabase(planningCopy, true)
    const plan = buildD1ApplySql(planningCopy)
    const d1Copy = fixture()
    prepareStableReference(d1Copy)
    d1Copy.exec(`UPDATE notifications SET metadata = '{"shareId":"MissingShare123"}' WHERE id = 'SafeNotification123'`)

    expect(() => d1Copy.exec(plan)).toThrow()
    expect(
      d1Copy.prepare("SELECT 1 FROM _zpan_id_normalization_state WHERE key = 'completed_at'").get(),
    ).toBeUndefined()
    planningCopy.close()
    d1Copy.close()
  })

  it('rejects a same-count downloader replacement that escaped planned credential revocation', () => {
    const planningCopy = fixture()
    normalizeDatabase(planningCopy, true)
    const plan = buildD1ApplySql(planningCopy)
    const d1Copy = fixture()
    d1Copy.exec(`
      DELETE FROM downloaders WHERE id = 'SafeDownloader123';
      INSERT INTO downloaders VALUES ('ReplacementDownloader123', '', 'ReplacementJti123', 0);
    `)

    expect(() => d1Copy.exec(plan)).toThrow()
    expect(
      d1Copy.prepare("SELECT 1 FROM _zpan_id_normalization_state WHERE key = 'completed_at'").get(),
    ).toBeUndefined()
    planningCopy.close()
    d1Copy.close()
  })

  it('rolls back every mutation after an interruption', () => {
    const db = fixture()
    db.exec(`
      CREATE TRIGGER stop_normalization BEFORE UPDATE OF id ON matters
      BEGIN SELECT RAISE(ABORT, 'simulated interruption'); END;
    `)

    expect(() => normalizeDatabase(db, true)).toThrow('simulated interruption')
    expect(value(db, 'SELECT id AS value FROM user')).toBe('user-_legacy')
    expect(value(db, 'SELECT id AS value FROM matters')).toBe('matter_old-')
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_zpan_id_normalization_map'").get()).toBeUndefined()
    db.close()
  })

  it('requires the generated audit event-key schema before mapping legacy audit IDs', () => {
    const db = new Database(':memory:')
    db.exec("CREATE TABLE audit_events (id TEXT PRIMARY KEY); INSERT INTO audit_events VALUES ('legacy-event-')")

    expect(() => normalizeDatabase(db, true)).toThrow('schema_migration_required:0092_audit_event_key')
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_zpan_id_normalization_map'").get()).toBeUndefined()
    expect(value(db, 'SELECT id AS value FROM audit_events')).toBe('legacy-event-')
    db.close()
  })

  it.each([
    {
      name: 'archive queue work',
      prepare: (db: Database.Database) =>
        db.exec(
          "CREATE TABLE background_jobs (id TEXT PRIMARY KEY, status TEXT); INSERT INTO background_jobs VALUES ('Job123', 'queued')",
        ),
      error: 'maintenance_state_not_drained:archive_jobs=1,object_upload_sessions=0,download_tasks=0',
    },
    {
      name: 'an active multipart upload',
      prepare: (db: Database.Database) =>
        db.exec("UPDATE object_upload_sessions SET status = 'active' WHERE id = 'upload_old-'"),
      error: 'maintenance_state_not_drained:archive_jobs=0,object_upload_sessions=1,download_tasks=0',
    },
    {
      name: 'an active task-upload authorization',
      prepare: (db: Database.Database) => db.exec("UPDATE download_tasks SET status = 'assigned'"),
      error: 'maintenance_state_not_drained:archive_jobs=0,object_upload_sessions=0,download_tasks=1',
    },
  ])('fails before mutation until $name is drained', ({ prepare, error }) => {
    const db = fixture()
    prepare(db)

    expect(() => normalizeDatabase(db, true)).toThrow(error)
    expect(value(db, 'SELECT id AS value FROM user')).toBe('user-_legacy')
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_zpan_id_normalization_map'").get()).toBeUndefined()
    db.close()
  })

  it('fails before mutation when an ID-derived avatar object needs external cleanup', () => {
    const db = fixture()
    db.exec("ALTER TABLE user ADD COLUMN image TEXT; UPDATE user SET image = '/api/avatar-blobs/user/user-_legacy?v=1'")

    expect(() => normalizeDatabase(db, true)).toThrow('external_identity_image_reconciliation_required:1')
    expect(value(db, 'SELECT id AS value FROM user')).toBe('user-_legacy')
    db.close()
  })

  it('fails before mutation when an externally bound instance ID needs reconciliation', () => {
    const db = fixture()
    db.exec(`
      CREATE TABLE system_options (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE license_bindings (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, status TEXT NOT NULL);
      INSERT INTO system_options VALUES ('instance_id', 'instance_legacy');
      INSERT INTO license_bindings VALUES ('binding1', 'instance_legacy', 'active');
    `)

    expect(() => normalizeDatabase(db, true)).toThrow('external_instance_id_reconciliation_required:2')
    expect(value(db, 'SELECT id AS value FROM user')).toBe('user-_legacy')
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_zpan_id_normalization_map'").get()).toBeUndefined()
    db.close()
  })

  it('fails before mutation when an active Cloud binding owns an organization that would be remapped', () => {
    const db = fixture()
    db.exec(`
      CREATE TABLE license_bindings (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, status TEXT NOT NULL);
      INSERT INTO license_bindings VALUES ('binding1', 'SafeInstance123', 'active');
    `)

    expect(() => normalizeDatabase(db, true)).toThrow('external_organization_id_reconciliation_required:1')
    expect(value(db, 'SELECT id AS value FROM organization')).toBe('-org_legacy-')
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_zpan_id_normalization_map'").get()).toBeUndefined()
    db.close()
  })

  it('fails before mutation when an unsynced external usage event would change identity', () => {
    const db = fixture()
    db.exec("UPDATE cloud_traffic_reports SET status = 'pending'")

    expect(() => normalizeDatabase(db, true)).toThrow('external_usage_reconciliation_required:2')
    expect(value(db, 'SELECT id AS value FROM user')).toBe('user-_legacy')
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_zpan_id_normalization_map'").get()).toBeUndefined()
    db.close()
  })

  it('fails before mutation for unresolved remote-download and x402 references', () => {
    const db = fixture()
    db.exec(`
      CREATE TABLE remote_download_usage_reports (
        id TEXT PRIMARY KEY, org_id TEXT, downloader_id TEXT, task_id TEXT, status TEXT
      );
      CREATE TABLE x402_capacity_purchase_intents (id TEXT PRIMARY KEY, org_id TEXT, status TEXT);
      INSERT INTO remote_download_usage_reports VALUES (
        'usage_old-', '-org_legacy-', 'downloader_old-', 'task_old-', 'pending'
      );
      INSERT INTO x402_capacity_purchase_intents VALUES ('purchase_old-', '-org_legacy-', 'pending');
    `)

    expect(() => normalizeDatabase(db, true)).toThrow('external_usage_reconciliation_required:2')
    expect(value(db, 'SELECT id AS value FROM organization')).toBe('-org_legacy-')
    db.close()
  })

  it('fails atomically when a governed JSON document is malformed', () => {
    const db = fixture()
    db.exec("UPDATE audit_events SET metadata = '{broken'")

    expect(() => normalizeDatabase(db, true)).toThrow('invalid_json:audit_events.metadata')
    expect(value(db, 'SELECT id AS value FROM user')).toBe('user-_legacy')
    db.close()
  })

  it('handles an empty database', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE _cf_METADATA (key TEXT PRIMARY KEY, value TEXT)')
    expect(normalizeDatabase(db, true)).toMatchObject({ apply: true, rowCountsVerified: 0 })
    expect(db.prepare("SELECT value FROM _zpan_id_normalization_state WHERE key = 'completed_at'").get()).toBeTruthy()
    db.close()
  })

  it('runs the CLI dry-run and protected apply workflow', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zpan-normalize-cli-'))
    const databasePath = join(directory, 'legacy.db')
    const backupPath = join(directory, 'backup.db')
    const planPath = join(directory, 'apply.sql')
    fixture(databasePath).close()
    const run = async (...args: string[]) => {
      let stdout = ''
      await runNormalizationCli(args, (value) => {
        stdout += value
      })
      return stdout
    }

    try {
      expect(JSON.parse(await run('--sqlite', databasePath))).toMatchObject({ apply: false })

      expect(
        JSON.parse(await run('--sqlite', databasePath, '--apply', '--backup', backupPath, '--emit-d1-sql', planPath)),
      ).toMatchObject({ apply: true })
      expect(statSync(backupPath).mode & 0o777).toBe(0o600)
      expect(statSync(planPath).mode & 0o777).toBe(0o600)
      expect(readFileSync(planPath, 'utf8')).toContain('_zpan_id_normalization_map')

      await expect(run('--sqlite', databasePath, '--apply')).rejects.toThrow('id_normalization_backup_required')
      await expect(run('--sqlite', databasePath, '--emit-d1-sql', join(directory, 'invalid.sql'))).rejects.toThrow(
        'd1_plan_requires_apply',
      )
      await expect(run('--sqlite', join(directory, 'missing.db'))).rejects.toThrow('sqlite_database_missing')
      await expect(run()).rejects.toThrow('Usage: pnpm ids:normalize')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
