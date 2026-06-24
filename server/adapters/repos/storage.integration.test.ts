import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../../test/setup.js'
import { createStorageRepo } from './storage.js'

describe('createStorage', () => {
  it('sets filePath to empty string regardless of input', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).create({
      title: 'My Storage',
      bucket: 'my-bucket',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      capacity: 0,
    })
    expect(result.filePath).toBe('')
  })

  it('sets customHost to empty string when not provided', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).create({
      title: 'My Storage',
      bucket: 'my-bucket',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      capacity: 0,
    })
    expect(result.customHost).toBe('')
  })

  it('uses provided customHost when given', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).create({
      title: 'My Storage',
      bucket: 'my-bucket',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      customHost: 'https://cdn.example.com',
      capacity: 0,
    })
    expect(result.customHost).toBe('https://cdn.example.com')
  })

  it('sets capacity to 0 when not provided', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).create({
      title: 'My Storage',
      bucket: 'my-bucket',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      capacity: 0,
    })
    expect(result.capacity).toBe(0)
  })

  it('uses provided capacity when given', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).create({
      title: 'My Storage',
      bucket: 'my-bucket',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      capacity: 1073741824,
    })
    expect(result.capacity).toBe(1073741824)
  })

  it('initialises used to 0 and status to active', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).create({
      title: 'My Storage',
      bucket: 'my-bucket',
      endpoint: 'https://s3.example.com',
      region: 'auto',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      capacity: 0,
    })
    expect(result.used).toBe(0)
    expect(result.status).toBe('active')
  })

  it('persists the created row to the database', async () => {
    const { db } = await createTestApp()
    const created = await createStorageRepo(db).create({
      title: 'Persisted',
      bucket: 'my-bucket',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      capacity: 0,
    })
    const fetched = await createStorageRepo(db).get(created.id)
    expect(fetched?.id).toBe(created.id)
    expect(fetched?.title).toBe('Persisted')
  })
})

describe('updateStorage', () => {
  async function seed(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
    return createStorageRepo(db).create({
      title: 'Original',
      bucket: 'original-bucket',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      customHost: 'https://cdn.original.com',
      capacity: 500,
    })
  }

  it('returns null when storage does not exist', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).update('nonexistent', { title: 'New' })
    expect(result).toBeNull()
  })

  it('keeps existing values for fields not included in update', async () => {
    const { db } = await createTestApp()
    const created = await seed(db)
    const updated = await createStorageRepo(db).update(created.id, { title: 'Changed' })
    expect(updated?.bucket).toBe('original-bucket')
    expect(updated?.region).toBe('us-east-1')
    expect(updated?.accessKey).toBe('AKID')
    expect(updated?.secretKey).toBe('SECRET')
    expect(updated?.customHost).toBe('https://cdn.original.com')
    expect(updated?.capacity).toBe(500)
  })

  it('applies all provided optional fields', async () => {
    const { db } = await createTestApp()
    const created = await seed(db)
    const updated = await createStorageRepo(db).update(created.id, {
      title: 'Updated',
      bucket: 'new-bucket',
      endpoint: 'https://r2.example.com',
      region: 'auto',
      accessKey: 'NEW_AKID',
      secretKey: 'NEW_SECRET',
      customHost: 'https://cdn.new.com',
      capacity: 1000,
      status: 'disabled',
    })
    expect(updated?.title).toBe('Updated')
    expect(updated?.bucket).toBe('new-bucket')
    expect(updated?.endpoint).toBe('https://r2.example.com')
    expect(updated?.region).toBe('auto')
    expect(updated?.accessKey).toBe('NEW_AKID')
    expect(updated?.secretKey).toBe('NEW_SECRET')
    expect(updated?.customHost).toBe('https://cdn.new.com')
    expect(updated?.capacity).toBe(1000)
    expect(updated?.status).toBe('disabled')
  })

  it('updates only status leaving all other fields intact', async () => {
    const { db } = await createTestApp()
    const created = await seed(db)
    const updated = await createStorageRepo(db).update(created.id, { status: 'disabled' })
    expect(updated?.status).toBe('disabled')
    expect(updated?.title).toBe('Original')
  })

  it('updates the updatedAt timestamp', async () => {
    const { db } = await createTestApp()
    const created = await seed(db)
    const before = created.updatedAt.getTime()
    await new Promise((r) => setTimeout(r, 10))
    const updated = await createStorageRepo(db).update(created.id, { title: 'New Title' })
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})

describe('listStorages', () => {
  it('returns empty items and zero total when no storages exist', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).list()
    expect(result).toEqual({ items: [], total: 0 })
  })

  it('returns all storages ordered by createdAt ascending', async () => {
    const { db } = await createTestApp()
    await createStorageRepo(db).create({
      title: 'First',
      bucket: 'b1',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K1',
      secretKey: 'S1',
      capacity: 0,
    })
    await createStorageRepo(db).create({
      title: 'Second',
      bucket: 'b2',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K2',
      secretKey: 'S2',
      capacity: 0,
    })
    const result = await createStorageRepo(db).list()
    expect(result.total).toBe(2)
    expect(result.items).toHaveLength(2)
  })
})

describe('getStorage', () => {
  it('returns null when storage does not exist', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).get('nonexistent')
    expect(result).toBeNull()
  })

  it('returns the storage when it exists', async () => {
    const { db } = await createTestApp()
    const created = await createStorageRepo(db).create({
      title: 'Findable',
      bucket: 'b',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K',
      secretKey: 'S',
      capacity: 0,
    })
    const found = await createStorageRepo(db).get(created.id)
    expect(found?.id).toBe(created.id)
  })
})

describe('selectStorage', () => {
  async function seedActive(
    db: Awaited<ReturnType<typeof createTestApp>>['db'],
    opts: { capacity?: number; used?: number; status?: string; title?: string } = {},
  ) {
    const created = await createStorageRepo(db).create({
      title: opts.title ?? 'Seed',
      bucket: 'b',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K',
      secretKey: 'S',
      capacity: opts.capacity ?? 0,
    })
    if (opts.used !== undefined || opts.status !== undefined) {
      await db.run(
        sql`UPDATE storages SET used = ${opts.used ?? created.used}, status = ${opts.status ?? created.status} WHERE id = ${created.id}`,
      )
    }
    return createStorageRepo(db).get(created.id)
  }

  it('returns an active storage with unlimited capacity', async () => {
    const { db } = await createTestApp()
    const created = await seedActive(db)
    const found = await createStorageRepo(db).select()
    expect(found.id).toBe(created?.id)
  })

  it('returns the requested active storage with capacity even when it is not oldest', async () => {
    const { db } = await createTestApp()
    const first = await seedActive(db, { title: 'First' })
    const second = await seedActive(db, { title: 'Second' })

    const auto = await createStorageRepo(db).select()
    const targeted = await createStorageRepo(db).select(second?.id)

    expect(auto.id).toBe(first?.id)
    expect(targeted.id).toBe(second?.id)
  })

  it('rejects a requested inactive storage', async () => {
    const { db } = await createTestApp()
    const created = await seedActive(db, { status: 'disabled' })
    await expect(createStorageRepo(db).select(created?.id)).rejects.toThrow('No available storage')
  })

  it('rejects a requested full storage', async () => {
    const { db } = await createTestApp()
    const created = await seedActive(db, { capacity: 10, used: 10 })
    await expect(createStorageRepo(db).select(created?.id)).rejects.toThrow('No available storage')
  })

  it('throws when no active storage exists', async () => {
    const { db } = await createTestApp()
    await expect(createStorageRepo(db).select()).rejects.toThrow('No available storage')
  })
})

describe('deleteStorage', () => {
  it('returns not_found when storage does not exist', async () => {
    const { db } = await createTestApp()
    const result = await createStorageRepo(db).delete('nonexistent')
    expect(result).toBe('not_found')
  })

  it('deletes a storage that is not referenced by any matter', async () => {
    const { db } = await createTestApp()
    const created = await createStorageRepo(db).create({
      title: 'Deletable',
      bucket: 'b',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K',
      secretKey: 'S',
      capacity: 0,
    })
    const result = await createStorageRepo(db).delete(created.id)
    expect(result).toBe('ok')
    expect(await createStorageRepo(db).get(created.id)).toBeNull()
  })

  it('returns in_use when matters reference the storage', async () => {
    const { db } = await createTestApp()
    const created = await createStorageRepo(db).create({
      title: 'In Use',
      bucket: 'b',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K',
      secretKey: 'S',
      capacity: 0,
    })
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, storage_id, created_at, updated_at)
      VALUES ('m-ref', 'org-1', 'alias-ref', 'test.txt', 'text/plain', ${created.id}, ${now}, ${now})
    `)
    const result = await createStorageRepo(db).delete(created.id)
    expect(result).toBe('in_use')
  })
})
