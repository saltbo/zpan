import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup.js'
import { batchDelete, batchMove, batchTrash, MatterNotFoundError, MatterNotTrashedError } from './matter'

function seedStorage(db: ReturnType<typeof createTestApp>['db']) {
  const now = Date.now()
  return db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, capacity, used, status, created_at, updated_at)
    VALUES ('s1', 'Test', 'private', 'bucket', 'http://localhost:9000', 'auto', 'key', 'secret', '$UID/$RAW_NAME', 0, 0, 'active', ${now}, ${now})
  `)
}

function seedMatter(db: ReturnType<typeof createTestApp>['db'], overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now()
  const defaults = {
    id: 'f1',
    orgId: 'org1',
    alias: `alias-${Math.random().toString(36).slice(2, 8)}`,
    name: 'test.txt',
    type: 'text/plain',
    size: 100,
    dirtype: 0,
    parent: '',
    object: 'org1/test.txt',
    storageId: 's1',
    status: 'active',
  }
  const m = { ...defaults, ...overrides }
  return db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${m.id as string}, ${m.orgId as string}, ${m.alias as string}, ${m.name as string}, ${m.type as string}, ${m.size as number}, ${m.dirtype as number}, ${m.parent as string}, ${m.object as string}, ${m.storageId as string}, ${m.status as string}, ${now}, ${now})
  `)
}

describe('batchMove', () => {
  it('moves multiple items to a new parent', async () => {
    const { db } = createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'f1', orgId: 'org1' })
    await seedMatter(db, { id: 'f2', orgId: 'org1', alias: 'a2', name: 'file2.txt', object: 'org1/file2.txt' })
    await seedMatter(db, { id: 'folder1', orgId: 'org1', alias: 'a3', name: 'Folder', dirtype: 1, object: '' })

    await batchMove(db, 'org1', ['f1', 'f2'], 'folder1')

    const rows = await db.all<{ parent: string }>(sql`SELECT parent FROM matters WHERE id IN ('f1', 'f2')`)
    expect(rows.every((r) => r.parent === 'folder1')).toBe(true)
  })

  it('rejects if any ID does not belong to org', async () => {
    const { db } = createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'f1', orgId: 'org1' })
    await seedMatter(db, { id: 'f2', orgId: 'org2', alias: 'a2' })

    await expect(batchMove(db, 'org1', ['f1', 'f2'], 'folder1')).rejects.toThrow(MatterNotFoundError)
  })
})

describe('batchTrash', () => {
  it('trashes items and their children', async () => {
    const { db } = createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'folder1', orgId: 'org1', alias: 'af', name: 'Folder', dirtype: 1, object: '' })
    await seedMatter(db, { id: 'child1', orgId: 'org1', alias: 'ac', parent: 'folder1', name: 'child.txt' })
    await seedMatter(db, { id: 'f1', orgId: 'org1', alias: 'a1', name: 'standalone.txt' })

    await batchTrash(db, 'org1', ['folder1', 'f1'])

    const rows = await db.all<{ id: string; status: string }>(sql`SELECT id, status FROM matters WHERE org_id = 'org1'`)
    expect(rows.every((r) => r.status === 'trashed')).toBe(true)
  })

  it('rejects if any ID does not belong to org', async () => {
    const { db } = createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'f1', orgId: 'org1' })

    await expect(batchTrash(db, 'org2', ['f1'])).rejects.toThrow(MatterNotFoundError)
  })
})

describe('batchDelete', () => {
  it('deletes trashed items and returns S3 keys', async () => {
    const { db } = createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'f1', orgId: 'org1', status: 'trashed' })
    await seedMatter(db, { id: 'f2', orgId: 'org1', alias: 'a2', status: 'trashed', object: 'org1/file2.txt' })

    const result = await batchDelete(db, 'org1', ['f1', 'f2'])

    expect(result).not.toBeNull()
    expect(result!.objectKeys).toContain('org1/test.txt')
    expect(result!.objectKeys).toContain('org1/file2.txt')
    expect(result!.storageId).toBe('s1')

    const rows = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM matters WHERE org_id = 'org1'`)
    expect(rows[0].count).toBe(0)
  })

  it('rejects non-trashed items', async () => {
    const { db } = createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'f1', orgId: 'org1', status: 'active' })

    await expect(batchDelete(db, 'org1', ['f1'])).rejects.toThrow(MatterNotTrashedError)
  })

  it('rejects if any ID does not belong to org', async () => {
    const { db } = createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'f1', orgId: 'org1', status: 'trashed' })

    await expect(batchDelete(db, 'org2', ['f1'])).rejects.toThrow(MatterNotFoundError)
  })

  it('cascades delete into folder children', async () => {
    const { db } = createTestApp()
    await seedStorage(db)
    await seedMatter(db, {
      id: 'folder1',
      orgId: 'org1',
      alias: 'af',
      name: 'Folder',
      dirtype: 1,
      object: '',
      status: 'trashed',
    })
    await seedMatter(db, {
      id: 'child1',
      orgId: 'org1',
      alias: 'ac',
      parent: 'folder1',
      name: 'child.txt',
      status: 'trashed',
    })

    const result = await batchDelete(db, 'org1', ['folder1'])

    expect(result).not.toBeNull()
    expect(result!.objectKeys).toContain('org1/test.txt') // child's object key

    const rows = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM matters WHERE org_id = 'org1'`)
    expect(rows[0].count).toBe(0)
  })
})
