import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup.js'
import { collectForDeletion, collectTrash, getMatter, permanentDelete, restore, trash } from './matter.js'

type TestDb = ReturnType<typeof createTestApp>['db']

const ORG = 'org-1'

async function insertStorage(db: TestDb, id: string, used = 0) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${id}, 'Test', 'private', 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '$UID/$RAW_NAME', '', 0, ${used}, 'active', ${now}, ${now})
  `)
}

async function insertQuota(db: TestDb, orgId: string, used: number) {
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used) VALUES (${`${orgId}-q`}, ${orgId}, 0, ${used})
  `)
}

async function insertMatter(
  db: TestDb,
  opts: {
    id: string
    orgId?: string
    name: string
    status?: string
    size?: number
    dirtype?: number
    parent?: string
    object?: string
    storageId?: string
  },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${opts.orgId ?? ORG}, ${opts.id}, ${opts.name}, 'application/octet-stream',
            ${opts.size ?? 0}, ${opts.dirtype ?? 0}, ${opts.parent ?? ''}, ${opts.object ?? `${opts.id}.bin`},
            ${opts.storageId ?? 's1'}, ${opts.status ?? 'active'}, ${now}, ${now})
  `)
}

async function getStorageUsed(db: TestDb, id: string): Promise<number> {
  const rows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${id}`)
  return rows[0]?.used ?? 0
}

async function getQuotaUsed(db: TestDb, orgId: string): Promise<number> {
  const rows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
  return rows[0]?.used ?? 0
}

async function matterExists(db: TestDb, id: string): Promise<boolean> {
  const rows = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM matters WHERE id = ${id}`)
  return (rows[0]?.count ?? 0) > 0
}

describe('MatterService — trash', () => {
  it('trashes an active file', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'f1', name: 'test.txt' })

    const result = await trash(db, ORG, 'f1')
    expect(result).toBe('ok')

    const matter = await getMatter(db, ORG, 'f1')
    expect(matter!.status).toBe('trashed')
  })

  it('returns not_found for missing matter', async () => {
    const { db } = createTestApp()
    const result = await trash(db, ORG, 'missing')
    expect(result).toBe('not_found')
  })

  it('returns already_trashed for trashed matter', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'f1', name: 'test.txt', status: 'trashed' })

    const result = await trash(db, ORG, 'f1')
    expect(result).toBe('already_trashed')
  })

  it('cascades to folder children', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'dir1', name: 'folder', dirtype: 1 })
    await insertMatter(db, { id: 'f1', name: 'child1.txt', parent: 'dir1', size: 50 })
    await insertMatter(db, { id: 'f2', name: 'child2.txt', parent: 'dir1', size: 60 })

    const result = await trash(db, ORG, 'dir1')
    expect(result).toBe('ok')

    expect((await getMatter(db, ORG, 'dir1'))!.status).toBe('trashed')
    expect((await getMatter(db, ORG, 'f1'))!.status).toBe('trashed')
    expect((await getMatter(db, ORG, 'f2'))!.status).toBe('trashed')
  })

  it('cascades to nested subfolders', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'dir1', name: 'top', dirtype: 1 })
    await insertMatter(db, { id: 'dir2', name: 'sub', dirtype: 1, parent: 'dir1' })
    await insertMatter(db, { id: 'f1', name: 'deep.txt', parent: 'dir2' })

    await trash(db, ORG, 'dir1')

    expect((await getMatter(db, ORG, 'dir1'))!.status).toBe('trashed')
    expect((await getMatter(db, ORG, 'dir2'))!.status).toBe('trashed')
    expect((await getMatter(db, ORG, 'f1'))!.status).toBe('trashed')
  })
})

describe('MatterService — restore', () => {
  it('restores a trashed file', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'f1', name: 'test.txt', status: 'trashed' })

    const result = await restore(db, ORG, 'f1')
    expect(result).toBe('ok')
    expect((await getMatter(db, ORG, 'f1'))!.status).toBe('active')
  })

  it('returns not_found for missing matter', async () => {
    const { db } = createTestApp()
    const result = await restore(db, ORG, 'missing')
    expect(result).toBe('not_found')
  })

  it('returns not_trashed for active matter', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'f1', name: 'test.txt', status: 'active' })

    const result = await restore(db, ORG, 'f1')
    expect(result).toBe('not_trashed')
  })

  it('cascades to folder children', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'dir1', name: 'folder', dirtype: 1, status: 'trashed' })
    await insertMatter(db, { id: 'f1', name: 'child.txt', parent: 'dir1', status: 'trashed' })
    await insertMatter(db, { id: 'f2', name: 'child2.txt', parent: 'dir1', status: 'trashed' })

    const result = await restore(db, ORG, 'dir1')
    expect(result).toBe('ok')

    expect((await getMatter(db, ORG, 'dir1'))!.status).toBe('active')
    expect((await getMatter(db, ORG, 'f1'))!.status).toBe('active')
    expect((await getMatter(db, ORG, 'f2'))!.status).toBe('active')
  })
})

describe('MatterService — collectForDeletion', () => {
  it('returns not_found for missing matter', async () => {
    const { db } = createTestApp()
    const result = await collectForDeletion(db, ORG, 'missing')
    expect(result.result).toBe('not_found')
  })

  it('returns not_trashed for active matter', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'f1', name: 'test.txt', status: 'active' })

    const result = await collectForDeletion(db, ORG, 'f1')
    expect(result.result).toBe('not_trashed')
  })

  it('collects a single trashed file', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'f1', name: 'test.txt', status: 'trashed', size: 100 })

    const result = await collectForDeletion(db, ORG, 'f1')
    expect(result.result).toBe('ok')
    if (result.result === 'ok') {
      expect(result.matters).toHaveLength(1)
      expect(result.matters[0].id).toBe('f1')
    }
  })

  it('collects folder and its descendants', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'dir1', name: 'folder', dirtype: 1, status: 'trashed' })
    await insertMatter(db, { id: 'f1', name: 'child.txt', parent: 'dir1', status: 'trashed', size: 50 })
    await insertMatter(db, { id: 'f2', name: 'child2.txt', parent: 'dir1', status: 'trashed', size: 60 })

    const result = await collectForDeletion(db, ORG, 'dir1')
    expect(result.result).toBe('ok')
    if (result.result === 'ok') {
      expect(result.matters).toHaveLength(3)
      const ids = result.matters.map((m) => m.id).sort()
      expect(ids).toEqual(['dir1', 'f1', 'f2'])
    }
  })
})

describe('MatterService — permanentDelete', () => {
  it('deletes matter rows and updates storage + quota', async () => {
    const { db } = createTestApp()
    await insertStorage(db, 's1', 1000)
    await insertQuota(db, ORG, 1000)
    await insertMatter(db, { id: 'f1', name: 'test.txt', status: 'trashed', size: 200 })

    const collected = await collectForDeletion(db, ORG, 'f1')
    expect(collected.result).toBe('ok')
    if (collected.result !== 'ok') return

    await permanentDelete(db, collected.matters)

    expect(await matterExists(db, 'f1')).toBe(false)
    expect(await getStorageUsed(db, 's1')).toBe(800)
    expect(await getQuotaUsed(db, ORG)).toBe(800)
  })

  it('deletes folder with children and updates quotas correctly', async () => {
    const { db } = createTestApp()
    await insertStorage(db, 's1', 1000)
    await insertQuota(db, ORG, 1000)
    await insertMatter(db, { id: 'dir1', name: 'folder', dirtype: 1, status: 'trashed' })
    await insertMatter(db, { id: 'f1', name: 'child.txt', parent: 'dir1', status: 'trashed', size: 100 })
    await insertMatter(db, { id: 'f2', name: 'child2.txt', parent: 'dir1', status: 'trashed', size: 150 })

    const collected = await collectForDeletion(db, ORG, 'dir1')
    if (collected.result !== 'ok') return

    await permanentDelete(db, collected.matters)

    expect(await matterExists(db, 'dir1')).toBe(false)
    expect(await matterExists(db, 'f1')).toBe(false)
    expect(await matterExists(db, 'f2')).toBe(false)
    expect(await getStorageUsed(db, 's1')).toBe(750)
    expect(await getQuotaUsed(db, ORG)).toBe(750)
  })

  it('handles zero-size files without breaking quota', async () => {
    const { db } = createTestApp()
    await insertStorage(db, 's1', 500)
    await insertQuota(db, ORG, 500)
    await insertMatter(db, { id: 'f1', name: 'empty.txt', status: 'trashed', size: 0 })

    const collected = await collectForDeletion(db, ORG, 'f1')
    if (collected.result !== 'ok') return

    await permanentDelete(db, collected.matters)

    expect(await matterExists(db, 'f1')).toBe(false)
    expect(await getStorageUsed(db, 's1')).toBe(500)
    expect(await getQuotaUsed(db, ORG)).toBe(500)
  })
})

describe('MatterService — collectTrash / emptyTrash', () => {
  it('collects all trashed items for an org', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'f1', name: 'a.txt', status: 'trashed' })
    await insertMatter(db, { id: 'f2', name: 'b.txt', status: 'trashed' })
    await insertMatter(db, { id: 'f3', name: 'keep.txt', status: 'active' })

    const trashed = await collectTrash(db, ORG)
    expect(trashed).toHaveLength(2)
    const ids = trashed.map((m) => m.id).sort()
    expect(ids).toEqual(['f1', 'f2'])
  })

  it('returns empty array when no trashed items', async () => {
    const { db } = createTestApp()
    await insertMatter(db, { id: 'f1', name: 'active.txt', status: 'active' })

    const trashed = await collectTrash(db, ORG)
    expect(trashed).toHaveLength(0)
  })

  it('permanentDelete on all trashed items (empty trash flow)', async () => {
    const { db } = createTestApp()
    await insertStorage(db, 's1', 1000)
    await insertQuota(db, ORG, 1000)
    await insertMatter(db, { id: 'f1', name: 'a.txt', status: 'trashed', size: 100 })
    await insertMatter(db, { id: 'f2', name: 'b.txt', status: 'trashed', size: 200 })
    await insertMatter(db, { id: 'f3', name: 'keep.txt', status: 'active', size: 50 })

    const trashed = await collectTrash(db, ORG)
    await permanentDelete(db, trashed)

    expect(await matterExists(db, 'f1')).toBe(false)
    expect(await matterExists(db, 'f2')).toBe(false)
    expect(await matterExists(db, 'f3')).toBe(true)
    expect(await getStorageUsed(db, 's1')).toBe(700)
    expect(await getQuotaUsed(db, ORG)).toBe(700)
  })
})
