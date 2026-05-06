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
