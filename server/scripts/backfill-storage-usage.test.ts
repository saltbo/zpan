import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { buildStorageUsageBackfillSql } from '../../scripts/backfill-storage-usage'

describe('storage usage backfill', () => {
  it('recalculates every category for every organization and can be rerun', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE organization (id TEXT PRIMARY KEY);
      CREATE TABLE matters (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        type TEXT NOT NULL,
        size INTEGER,
        status TEXT NOT NULL,
        dirtype INTEGER NOT NULL,
        trashed_at INTEGER,
        purged_at INTEGER
      );
      CREATE TABLE image_hostings (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        size INTEGER NOT NULL,
        status TEXT NOT NULL,
        purged_at INTEGER
      );
      CREATE TABLE storage_usage_breakdowns (
        org_id TEXT NOT NULL,
        category TEXT NOT NULL,
        bytes INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(org_id, category)
      );

      INSERT INTO organization (id) VALUES ('org-1'), ('org-empty');
      INSERT INTO matters
        (id, org_id, type, size, status, dirtype, trashed_at, purged_at)
      VALUES
        ('photo', 'org-1', 'image/jpeg', 100, 'active', 0, NULL, NULL),
        ('document', 'org-1', 'application/pdf', 200, 'active', 0, NULL, NULL),
        ('trash', 'org-1', 'video/mp4', 300, 'active', 0, 1, NULL),
        ('folder', 'org-1', 'application/x-directory', 0, 'active', 1, NULL, NULL),
        ('purged', 'org-1', 'audio/mpeg', 400, 'active', 0, NULL, 1);
      INSERT INTO image_hostings (id, org_id, size, status, purged_at)
      VALUES ('image-host', 'org-1', 500, 'active', NULL);
    `)

    db.exec(buildStorageUsageBackfillSql(1000))

    const rows = db
      .prepare(
        `SELECT org_id AS orgId, category, bytes, file_count AS fileCount, updated_at AS updatedAt
         FROM storage_usage_breakdowns
         ORDER BY org_id, category`,
      )
      .all() as Array<{ orgId: string; category: string; bytes: number; fileCount: number; updatedAt: number }>
    expect(rows).toHaveLength(16)
    expect(rows).toContainEqual({
      orgId: 'org-1',
      category: 'photos',
      bytes: 100,
      fileCount: 1,
      updatedAt: 1000,
    })
    expect(rows).toContainEqual({
      orgId: 'org-1',
      category: 'documents',
      bytes: 200,
      fileCount: 1,
      updatedAt: 1000,
    })
    expect(rows).toContainEqual({
      orgId: 'org-1',
      category: 'trash',
      bytes: 300,
      fileCount: 1,
      updatedAt: 1000,
    })
    expect(rows).toContainEqual({
      orgId: 'org-1',
      category: 'image_hosting',
      bytes: 500,
      fileCount: 1,
      updatedAt: 1000,
    })

    db.exec("UPDATE matters SET size = 150 WHERE id = 'photo'")
    db.exec(buildStorageUsageBackfillSql(2000))

    expect(
      db
        .prepare(
          "SELECT bytes, updated_at AS updatedAt FROM storage_usage_breakdowns WHERE org_id = 'org-1' AND category = 'photos'",
        )
        .get(),
    ).toEqual({ bytes: 150, updatedAt: 2000 })
    db.close()
  })
})
