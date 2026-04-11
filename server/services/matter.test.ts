import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { orgQuotas } from '../db/schema.js'
import { createTestApp } from '../test/setup.js'
import { confirmUpload, incrementUsageIfAllowed, listTrashedRoots, updateMatter } from './matter.js'

type TestDb = ReturnType<typeof createTestApp>['db']

async function insertStorage(db: TestDb, opts: { id?: string; used?: number } = {}) {
  const id = opts.id ?? 'st-1'
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${id}, 'Test S3', 'private', 'test-bucket', 'https://s3.example.com', 'us-east-1',
            'AKID', 'SECRET', '$UID/$RAW_NAME', '', 0, ${opts.used ?? 0}, 'active', ${now}, ${now})
  `)
  return id
}

async function insertOrgQuota(db: TestDb, orgId: string, quota: number, used = 0) {
  await db.insert(orgQuotas).values({ id: nanoid(), orgId, quota, used })
}

async function insertDraftFile(
  db: TestDb,
  orgId: string,
  opts: { id?: string; size?: number; storageId?: string } = {},
) {
  const id = opts.id ?? nanoid()
  const storageId = opts.storageId ?? 'st-1'
  const size = opts.size ?? 100
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${`${id}-alias`}, 'file.txt', 'text/plain', ${size}, 0, '', 'some/key.txt', ${storageId}, 'draft', ${now}, ${now})
  `)
  return id
}

// ─── incrementUsageIfAllowed ──────────────────────────────────────────────────

describe('incrementUsageIfAllowed', () => {
  it('returns true and increments when no quota row exists (unlimited)', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-ul', used: 0 })

    const result = await incrementUsageIfAllowed(db, orgId, storageId, 500)

    expect(result).toBe(true)
    const rows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storageId}`)
    expect(rows[0].used).toBe(500)
  })

  it('returns true and increments when quota is 0 (unlimited)', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-q0', used: 100 })
    await insertOrgQuota(db, orgId, 0, 5000)

    const result = await incrementUsageIfAllowed(db, orgId, storageId, 999999)

    expect(result).toBe(true)
    const rows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storageId}`)
    expect(rows[0].used).toBe(1000099)
  })

  it('returns true and increments when used + bytes is within quota', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-in', used: 0 })
    await insertOrgQuota(db, orgId, 1000, 400)

    const result = await incrementUsageIfAllowed(db, orgId, storageId, 500)

    expect(result).toBe(true)
  })

  it('returns true and increments when used + bytes is exactly at quota', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-exact', used: 0 })
    await insertOrgQuota(db, orgId, 1000, 500)

    const result = await incrementUsageIfAllowed(db, orgId, storageId, 500)

    expect(result).toBe(true)
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotaRows[0].used).toBe(1000)
  })

  it('returns false and does not increment when used + bytes exceeds quota', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-over', used: 50 })
    await insertOrgQuota(db, orgId, 1000, 800)

    const result = await incrementUsageIfAllowed(db, orgId, storageId, 201)

    expect(result).toBe(false)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storageId}`)
    expect(storageRows[0].used).toBe(50) // unchanged
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotaRows[0].used).toBe(800) // unchanged
  })

  it('returns false and does not increment when quota is fully consumed', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-full', used: 100 })
    await insertOrgQuota(db, orgId, 1000, 1000)

    const result = await incrementUsageIfAllowed(db, orgId, storageId, 1)

    expect(result).toBe(false)
  })

  it('increments orgQuotas.used when within quota', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-q-inc', used: 0 })
    await insertOrgQuota(db, orgId, 5000, 200)

    await incrementUsageIfAllowed(db, orgId, storageId, 300)

    const rows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(rows[0].used).toBe(500)
  })

  it('increments storages.used when within quota', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-s-inc', used: 100 })
    await insertOrgQuota(db, orgId, 5000, 100)

    await incrementUsageIfAllowed(db, orgId, storageId, 400)

    const rows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storageId}`)
    expect(rows[0].used).toBe(500)
  })
})

// ─── confirmUpload ────────────────────────────────────────────────────────────

describe('confirmUpload', () => {
  it('returns { matter } with status active and increments usage for a draft file with size > 0', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-conf', used: 0 })
    await insertOrgQuota(db, orgId, 10000, 0)
    const matterId = await insertDraftFile(db, orgId, { id: 'matter-a', size: 500, storageId })

    const result = await confirmUpload(db, matterId, orgId)

    expect(result.matter).not.toBeNull()
    expect(result.matter?.status).toBe('active')
    expect(result.quotaExceeded).toBeUndefined()

    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storageId}`)
    expect(storageRows[0].used).toBe(500)
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotaRows[0].used).toBe(500)
  })

  it('returns { matter } and does not increment usage when file size is 0', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-conf2', used: 50 })
    await insertOrgQuota(db, orgId, 10000, 50)
    const matterId = await insertDraftFile(db, orgId, { id: 'matter-b', size: 0, storageId })

    const result = await confirmUpload(db, matterId, orgId)

    expect(result.matter?.status).toBe('active')
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storageId}`)
    expect(storageRows[0].used).toBe(50) // unchanged
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotaRows[0].used).toBe(50) // unchanged
  })

  it('returns { matter: null } for a non-existent matter', async () => {
    const { db } = createTestApp()
    const result = await confirmUpload(db, 'nonexistent', 'org-x')
    expect(result.matter).toBeNull()
    expect(result.quotaExceeded).toBeUndefined()
  })

  it('returns { matter: null } for a matter not in draft status', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-conf3' })
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('matter-active', ${orgId}, 'matter-active-alias', 'file.txt', 'text/plain', 100, 0, '', 'key', ${storageId}, 'active', ${now}, ${now})
    `)

    const result = await confirmUpload(db, 'matter-active', orgId)
    expect(result.matter).toBeNull()
  })

  it('returns { matter: null, quotaExceeded: true } when quota would be exceeded', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-conf4', used: 0 })
    // quota=100, used=90, file size=50 → would exceed
    await insertOrgQuota(db, orgId, 100, 90)
    const matterId = await insertDraftFile(db, orgId, { id: 'matter-quota', size: 50, storageId })

    const result = await confirmUpload(db, matterId, orgId)

    expect(result.matter).toBeNull()
    expect(result.quotaExceeded).toBe(true)
  })

  it('status remains draft in DB when quota would be exceeded', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-conf5', used: 0 })
    await insertOrgQuota(db, orgId, 100, 90)
    const matterId = await insertDraftFile(db, orgId, { id: 'matter-quo2', size: 50, storageId })

    await confirmUpload(db, matterId, orgId)

    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id = ${matterId}`)
    expect(rows[0].status).toBe('draft')
  })
})

// ─── updateMatter — folder-into-itself error ──────────────────────────────────

describe('updateMatter', () => {
  it('throws when moving a folder into itself', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-upd1' })
    const now = Date.now()
    // Insert a folder
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('folder-self', ${orgId}, 'folder-self-alias', 'MyFolder', 'folder', 0, 1, '', '', ${storageId}, 'active', ${now}, ${now})
    `)

    await expect(updateMatter(db, 'folder-self', orgId, { parent: 'MyFolder' })).rejects.toThrow(
      'Cannot move a folder into itself or its subfolder',
    )
  })

  it('throws when moving a folder into its own subfolder', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-upd2' })
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('folder-sub', ${orgId}, 'folder-sub-alias', 'Root', 'folder', 0, 1, '', '', ${storageId}, 'active', ${now}, ${now})
    `)

    await expect(updateMatter(db, 'folder-sub', orgId, { parent: 'Root/sub' })).rejects.toThrow(
      'Cannot move a folder into itself or its subfolder',
    )
  })
})

// ─── listTrashedRoots ─────────────────────────────────────────────────────────

async function insertTrashedMatter(
  db: TestDb,
  orgId: string,
  opts: { id: string; alias: string; name: string; parent: string; dirtype: number; storageId: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${opts.alias}, ${opts.name}, 'text/plain', 0, ${opts.dirtype}, ${opts.parent}, '', ${opts.storageId}, 'trashed', ${now}, ${now}, ${now})
  `)
}

describe('listTrashedRoots', () => {
  it('returns only the top-level trashed folder when a folder and its child file are both trashed', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-trash1' })

    // Folder "A" at root, child file "A/file.txt"
    await insertTrashedMatter(db, orgId, {
      id: 'folder-a',
      alias: 'folder-a-alias',
      name: 'A',
      parent: '',
      dirtype: 1,
      storageId,
    })
    await insertTrashedMatter(db, orgId, {
      id: 'file-in-a',
      alias: 'file-in-a-alias',
      name: 'file.txt',
      parent: 'A',
      dirtype: 0,
      storageId,
    })

    const roots = await listTrashedRoots(db, orgId)

    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe('folder-a')
  })

  it('does not return the child file when it is nested inside a trashed folder', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-trash2' })

    await insertTrashedMatter(db, orgId, {
      id: 'folder-b',
      alias: 'folder-b-alias',
      name: 'B',
      parent: '',
      dirtype: 1,
      storageId,
    })
    await insertTrashedMatter(db, orgId, {
      id: 'file-in-b',
      alias: 'file-in-b-alias',
      name: 'notes.txt',
      parent: 'B',
      dirtype: 0,
      storageId,
    })

    const roots = await listTrashedRoots(db, orgId)
    const ids = roots.map((m) => m.id)

    expect(ids).not.toContain('file-in-b')
  })

  it('returns multiple independent trashed items when none is a descendant of another', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-trash3' })

    await insertTrashedMatter(db, orgId, {
      id: 'item-x',
      alias: 'item-x-alias',
      name: 'X',
      parent: '',
      dirtype: 0,
      storageId,
    })
    await insertTrashedMatter(db, orgId, {
      id: 'item-y',
      alias: 'item-y-alias',
      name: 'Y',
      parent: '',
      dirtype: 0,
      storageId,
    })

    const roots = await listTrashedRoots(db, orgId)
    const ids = roots.map((m) => m.id)

    expect(ids).toContain('item-x')
    expect(ids).toContain('item-y')
    expect(roots).toHaveLength(2)
  })

  it('returns an empty array when no trashed items exist for the org', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()

    const roots = await listTrashedRoots(db, orgId)

    expect(roots).toHaveLength(0)
  })

  it('excludes items belonging to a different org', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const otherOrgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-trash4' })

    await insertTrashedMatter(db, otherOrgId, {
      id: 'other-org-item',
      alias: 'other-org-item-alias',
      name: 'SomeFile',
      parent: '',
      dirtype: 0,
      storageId,
    })

    const roots = await listTrashedRoots(db, orgId)

    expect(roots).toHaveLength(0)
  })

  it('returns deeply-nested trashed folders that are themselves roots (parent folder not trashed)', async () => {
    const { db } = createTestApp()
    const orgId = nanoid()
    const storageId = await insertStorage(db, { id: 'st-trash5' })

    // Only the subfolder "Docs/Archive" is trashed — its parent "Docs" is not
    await insertTrashedMatter(db, orgId, {
      id: 'archive-folder',
      alias: 'archive-folder-alias',
      name: 'Archive',
      parent: 'Docs',
      dirtype: 1,
      storageId,
    })
    await insertTrashedMatter(db, orgId, {
      id: 'file-in-archive',
      alias: 'file-in-archive-alias',
      name: 'report.pdf',
      parent: 'Docs/Archive',
      dirtype: 0,
      storageId,
    })

    const roots = await listTrashedRoots(db, orgId)

    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe('archive-folder')
  })
})
