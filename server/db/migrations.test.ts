import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

type OrgQuotaRow = {
  id: string
  orgId: string
  quota: number
  used: number
  trafficQuota: number
  trafficUsed: number
  trafficPeriod: string
}

describe('migration 0022_kind_storm.sql', () => {
  const migrationPath = join(process.cwd(), 'migrations/0022_kind_storm.sql')
  const migration = readFileSync(migrationPath, 'utf-8')

  it('backfills org_quotas for organizations missing quota rows', () => {
    const db = new Database(':memory:')

    try {
      db.exec(`
        CREATE TABLE organization (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER
        );
        CREATE TABLE org_quotas (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          quota INTEGER NOT NULL DEFAULT 0,
          used INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO organization (id, name, slug, created_at, updated_at)
        VALUES ('org-existing', 'Existing', 'existing', 1, 1),
               ('org-missing', 'Missing', 'missing', 1, 1);
        INSERT INTO org_quotas (id, org_id, quota, used)
        VALUES ('quota-existing', 'org-existing', 1024, 128);
      `)

      for (const statement of migration.split('--> statement-breakpoint')) {
        db.exec(statement)
      }

      const rows = db
        .prepare(
          `
            SELECT id, org_id AS orgId, quota, used, traffic_quota AS trafficQuota,
                   traffic_used AS trafficUsed, traffic_period AS trafficPeriod
            FROM org_quotas
            ORDER BY org_id
          `,
        )
        .all() as OrgQuotaRow[]

      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({
        id: 'quota-existing',
        orgId: 'org-existing',
        quota: 1024,
        used: 128,
        trafficQuota: 0,
        trafficUsed: 0,
        trafficPeriod: '1970-01',
      })
      expect(rows[1]).toMatchObject({
        id: 'quota_org-missing',
        orgId: 'org-missing',
        quota: 0,
        used: 0,
        trafficQuota: 0,
        trafficUsed: 0,
      })
      expect(rows[1].trafficPeriod).toMatch(/^\d{4}-\d{2}$/)
    } finally {
      db.close()
    }
  })
})

describe('migration 0092_base62_audit_event_key.sql', () => {
  const migrationPath = join(process.cwd(), 'migrations/0092_base62_audit_event_key.sql')
  const migration = readFileSync(migrationPath, 'utf-8')

  it('adds a nullable unique idempotency key without rewriting audit primary IDs', () => {
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE audit_events (id TEXT PRIMARY KEY)')
      db.exec("INSERT INTO audit_events (id) VALUES ('legacy-event-id')")
      for (const statement of migration.split('--> statement-breakpoint')) db.exec(statement)

      expect(db.prepare('SELECT id, event_key FROM audit_events').get()).toEqual({
        id: 'legacy-event-id',
        event_key: null,
      })
      db.exec("INSERT INTO audit_events (id, event_key) VALUES ('new-id', 'event:key')")
      expect(() => db.exec("INSERT INTO audit_events (id, event_key) VALUES ('other-id', 'event:key')")).toThrow()
    } finally {
      db.close()
    }
  })
})

describe('migration 0093_redirect-token-registry.sql', () => {
  const migrationPath = join(process.cwd(), 'migrations/0093_redirect-token-registry.sql')
  const migration = readFileSync(migrationPath, 'utf-8')

  it('creates a shared unique namespace for redirect token reservations', () => {
    const db = new Database(':memory:')
    try {
      for (const statement of migration.split('--> statement-breakpoint')) db.exec(statement)
      db.exec("INSERT INTO redirect_token_registry VALUES ('SharedToken1', 'direct_share', 'ShareId1')")
      expect(() =>
        db.exec("INSERT INTO redirect_token_registry VALUES ('SharedToken1', 'image_hosting', 'ImageId1')"),
      ).toThrow()
      expect(() =>
        db.exec("INSERT INTO redirect_token_registry VALUES ('OtherToken2', 'image_hosting', 'ShareId1')"),
      ).toThrow()
    } finally {
      db.close()
    }
  })
})

describe('migration 0094_redirect-token-kind-resource.sql', () => {
  const createMigration = readFileSync(join(process.cwd(), 'migrations/0093_redirect-token-registry.sql'), 'utf-8')
  const migration = readFileSync(join(process.cwd(), 'migrations/0094_redirect-token-kind-resource.sql'), 'utf-8')

  it('allows independent resource ID namespaces while retaining per-kind uniqueness', () => {
    const db = new Database(':memory:')
    try {
      for (const statement of createMigration.split('--> statement-breakpoint')) db.exec(statement)
      for (const statement of migration.split('--> statement-breakpoint')) db.exec(statement)
      db.exec("INSERT INTO redirect_token_registry VALUES ('ShareToken1', 'direct_share', 'SameId1')")
      db.exec("INSERT INTO redirect_token_registry VALUES ('ImageToken1', 'image_hosting', 'SameId1')")
      expect(() =>
        db.exec("INSERT INTO redirect_token_registry VALUES ('ShareToken2', 'direct_share', 'SameId1')"),
      ).toThrow()
    } finally {
      db.close()
    }
  })
})

describe('migration 0067_storage-health-status-default.sql', () => {
  const migrationPath = join(process.cwd(), 'migrations/0067_storage-health-status-default.sql')
  const migration = readFileSync(migrationPath, 'utf-8')

  it('rebuilds storages inside a transaction while preserving foreign key references', () => {
    const db = new Database(':memory:')

    try {
      db.pragma('foreign_keys = ON')
      db.exec(`
        CREATE TABLE storages (
          id TEXT PRIMARY KEY NOT NULL,
          provider TEXT DEFAULT '' NOT NULL,
          bucket TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          region TEXT DEFAULT 'auto' NOT NULL,
          access_key TEXT NOT NULL,
          secret_key TEXT NOT NULL,
          file_path TEXT DEFAULT '' NOT NULL,
          custom_host TEXT DEFAULT '',
          capacity INTEGER DEFAULT 0 NOT NULL,
          egress_credit_billing_enabled INTEGER DEFAULT 0 NOT NULL,
          egress_credit_unit_bytes INTEGER DEFAULT 104857600 NOT NULL,
          egress_credit_per_unit INTEGER DEFAULT 1 NOT NULL,
          force_path_style INTEGER DEFAULT 1 NOT NULL,
          used INTEGER DEFAULT 0 NOT NULL,
          enabled INTEGER DEFAULT 1 NOT NULL,
          status TEXT DEFAULT 'active' NOT NULL,
          status_checked_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE matters (
          id TEXT PRIMARY KEY NOT NULL,
          storage_id TEXT NOT NULL REFERENCES storages(id)
        );
        INSERT INTO storages (
          id, bucket, endpoint, access_key, secret_key, status, created_at, updated_at
        ) VALUES (
          'storage-1', 'bucket', 'https://s3.example.com', 'key', 'secret', 'active', 1, 1
        );
        INSERT INTO matters (id, storage_id) VALUES ('matter-1', 'storage-1');
      `)

      db.exec('BEGIN')
      for (const statement of migration.split('--> statement-breakpoint')) db.exec(statement)
      db.exec('COMMIT')

      expect(db.prepare('SELECT storage_id FROM matters').pluck().get()).toBe('storage-1')
      expect(db.pragma('foreign_key_check')).toEqual([])
      db.exec(`
        INSERT INTO storages (
          id, bucket, endpoint, access_key, secret_key, created_at, updated_at
        ) VALUES (
          'storage-2', 'bucket-2', 'https://s3.example.com', 'key', 'secret', 2, 2
        )
      `)
      expect(db.prepare("SELECT status FROM storages WHERE id = 'storage-2'").pluck().get()).toBe('untested')
    } finally {
      db.close()
    }
  })
})

describe('migration 0069_storage-health-status-vocabulary.sql', () => {
  const migrationPath = join(process.cwd(), 'migrations/0069_storage-health-status-vocabulary.sql')
  const migration = readFileSync(migrationPath, 'utf-8')

  it('changes the default with status_reason present and preserves foreign key references', () => {
    const db = new Database(':memory:')

    try {
      db.pragma('foreign_keys = ON')
      db.exec(`
        CREATE TABLE storages (
          id TEXT PRIMARY KEY NOT NULL,
          provider TEXT DEFAULT '' NOT NULL,
          bucket TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          region TEXT DEFAULT 'auto' NOT NULL,
          access_key TEXT NOT NULL,
          secret_key TEXT NOT NULL,
          file_path TEXT DEFAULT '' NOT NULL,
          custom_host TEXT DEFAULT '',
          capacity INTEGER DEFAULT 0 NOT NULL,
          egress_credit_billing_enabled INTEGER DEFAULT 0 NOT NULL,
          egress_credit_unit_bytes INTEGER DEFAULT 104857600 NOT NULL,
          egress_credit_per_unit INTEGER DEFAULT 1 NOT NULL,
          force_path_style INTEGER DEFAULT 1 NOT NULL,
          used INTEGER DEFAULT 0 NOT NULL,
          enabled INTEGER DEFAULT 1 NOT NULL,
          status TEXT DEFAULT 'untested' NOT NULL,
          status_reason TEXT,
          status_checked_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE matters (
          id TEXT PRIMARY KEY NOT NULL,
          storage_id TEXT NOT NULL REFERENCES storages(id)
        );
        INSERT INTO storages (
          id, bucket, endpoint, access_key, secret_key, status, created_at, updated_at
        ) VALUES (
          'storage-1', 'bucket', 'https://s3.example.com', 'key', 'secret', 'healthy', 1, 1
        );
        INSERT INTO matters (id, storage_id) VALUES ('matter-1', 'storage-1');
      `)

      db.exec('BEGIN')
      for (const statement of migration.split('--> statement-breakpoint')) db.exec(statement)
      db.exec('COMMIT')

      expect(db.prepare('SELECT storage_id FROM matters').pluck().get()).toBe('storage-1')
      expect(db.pragma('foreign_key_check')).toEqual([])
      db.exec(`
        INSERT INTO storages (
          id, bucket, endpoint, access_key, secret_key, created_at, updated_at
        ) VALUES (
          'storage-2', 'bucket-2', 'https://s3.example.com', 'key', 'secret', 2, 2
        )
      `)
      expect(db.prepare("SELECT status FROM storages WHERE id = 'storage-2'").pluck().get()).toBe('unknown')
    } finally {
      db.close()
    }
  })
})

describe('migration 0089_better-auth-account-issuer-backfill.sql', () => {
  const migrationPath = join(process.cwd(), 'migrations/0089_better-auth-account-issuer-backfill.sql')
  const migration = readFileSync(migrationPath, 'utf-8')

  it('backfills legacy credential and OAuth issuers without overwriting explicit issuers', () => {
    const db = new Database(':memory:')

    try {
      db.exec(`
        CREATE TABLE account (
          id TEXT PRIMARY KEY NOT NULL,
          issuer TEXT DEFAULT '' NOT NULL,
          account_id TEXT NOT NULL,
          provider_id TEXT NOT NULL
        );
        CREATE UNIQUE INDEX account_issuer_providerAccountId_unique ON account (issuer, account_id);
        INSERT INTO account (id, issuer, account_id, provider_id) VALUES
          ('credential', '', 'user-1', 'credential'),
          ('github', '', 'github-user', 'github'),
          ('google', '', 'google-user', 'google'),
          ('explicit', 'https://issuer.example.com', 'subject-1', 'external');
      `)

      db.exec(migration)
      db.exec(migration)

      expect(db.prepare('SELECT id, issuer FROM account ORDER BY id').all()).toEqual([
        { id: 'credential', issuer: 'local:credential' },
        { id: 'explicit', issuer: 'https://issuer.example.com' },
        { id: 'github', issuer: 'local:oauth:github' },
        { id: 'google', issuer: 'https://accounts.google.com' },
      ])
      expect(() =>
        db
          .prepare('INSERT INTO account (id, issuer, account_id, provider_id) VALUES (?, ?, ?, ?)')
          .run('duplicate', 'local:oauth:github', 'github-user', 'github'),
      ).toThrow(/UNIQUE constraint failed/)
    } finally {
      db.close()
    }
  })

  it('fails before changing data when a legacy provider has no safe issuer mapping', () => {
    const db = new Database(':memory:')

    try {
      db.exec(`
        CREATE TABLE account (
          id TEXT PRIMARY KEY NOT NULL,
          issuer TEXT DEFAULT '' NOT NULL,
          account_id TEXT NOT NULL,
          provider_id TEXT NOT NULL
        );
        CREATE UNIQUE INDEX account_issuer_providerAccountId_unique ON account (issuer, account_id);
        INSERT INTO account (id, issuer, account_id, provider_id) VALUES
          ('credential', '', 'user-1', 'credential'),
          ('unknown', '', 'subject-1', 'unknown-provider');
      `)

      expect(() => db.exec(migration)).toThrow(/malformed JSON/)
      expect(db.prepare('SELECT id, issuer FROM account ORDER BY id').all()).toEqual([
        { id: 'credential', issuer: '' },
        { id: 'unknown', issuer: '' },
      ])
    } finally {
      db.close()
    }
  })
})
