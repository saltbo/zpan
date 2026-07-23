import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { STORAGE_ENABLED_STATUS_BACKFILL_SQL } from '../../scripts/backfill-storage-enabled-status'

describe('storage enabled/status backfill', () => {
  it('converts legacy statuses and can be rerun', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE storages (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        status_reason TEXT,
        status_checked_at INTEGER
      );
      INSERT INTO storages (id, status, status_checked_at) VALUES
        ('active', 'active', 1),
        ('cors', 'cors', 2),
        ('disabled', 'disabled', 2),
        ('failed', 'failed', 3),
        ('inactive', 'inactive', 3),
        ('untested', 'untested', 4),
        ('healthy', 'healthy', 4);
      INSERT INTO storages (id, enabled, status, status_checked_at)
      VALUES ('disabled-untested', 0, 'untested', 5);
    `)

    db.exec(STORAGE_ENABLED_STATUS_BACKFILL_SQL)
    db.exec(STORAGE_ENABLED_STATUS_BACKFILL_SQL)

    expect(
      db
        .prepare(
          'SELECT id, enabled, status, status_reason AS reason, status_checked_at AS checkedAt FROM storages ORDER BY id',
        )
        .all(),
    ).toEqual([
      { id: 'active', enabled: 1, status: 'unknown', reason: null, checkedAt: null },
      { id: 'cors', enabled: 1, status: 'unhealthy', reason: 'cors', checkedAt: 2 },
      { id: 'disabled', enabled: 0, status: 'unknown', reason: null, checkedAt: null },
      { id: 'disabled-untested', enabled: 0, status: 'unknown', reason: null, checkedAt: null },
      { id: 'failed', enabled: 1, status: 'unhealthy', reason: 'unknown', checkedAt: 3 },
      { id: 'healthy', enabled: 1, status: 'healthy', reason: null, checkedAt: 4 },
      { id: 'inactive', enabled: 0, status: 'unknown', reason: null, checkedAt: null },
      { id: 'untested', enabled: 1, status: 'unknown', reason: null, checkedAt: null },
    ])
    db.close()
  })
})
