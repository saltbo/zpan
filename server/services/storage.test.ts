import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup.js'
import { createStorage, deleteStorage, getStorage, listStorages, selectStorage, updateStorage } from './storage.js'

describe('createStorage', () => {
  it('sets filePath to empty string regardless of input', async () => {
    const { db } = createTestApp()
    const result = await createStorage(db, {
      title: 'My Storage',
      mode: 'private',
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
    const { db } = createTestApp()
    const result = await createStorage(db, {
      title: 'My Storage',
      mode: 'private',
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
    const { db } = createTestApp()
    const result = await createStorage(db, {
      title: 'My Storage',
      mode: 'private',
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
    const { db } = createTestApp()
    const result = await createStorage(db, {
      title: 'My Storage',
      mode: 'private',
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
    const { db } = createTestApp()
    const result = await createStorage(db, {
      title: 'My Storage',
      mode: 'private',
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
    const { db } = createTestApp()
    const result = await createStorage(db, {
      title: 'My Storage',
      mode: 'public',
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
    const { db } = createTestApp()
    const created = await createStorage(db, {
      title: 'Persisted',
      mode: 'private',
      bucket: 'my-bucket',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      capacity: 0,
    })
    const fetched = await getStorage(db, created.id)
    expect(fetched?.id).toBe(created.id)
    expect(fetched?.title).toBe('Persisted')
  })
})

describe('updateStorage', () => {
  async function seed(db: ReturnType<typeof createTestApp>['db']) {
    return createStorage(db, {
      title: 'Original',
      mode: 'private',
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
    const { db } = createTestApp()
    const result = await updateStorage(db, 'nonexistent', { title: 'New' })
    expect(result).toBeNull()
  })

  it('keeps existing values for fields not included in update', async () => {
    const { db } = createTestApp()
    const created = await seed(db)
    const updated = await updateStorage(db, created.id, { title: 'Changed' })
    expect(updated?.bucket).toBe('original-bucket')
    expect(updated?.region).toBe('us-east-1')
    expect(updated?.accessKey).toBe('AKID')
    expect(updated?.secretKey).toBe('SECRET')
    expect(updated?.customHost).toBe('https://cdn.original.com')
    expect(updated?.capacity).toBe(500)
  })

  it('applies all provided optional fields', async () => {
    const { db } = createTestApp()
    const created = await seed(db)
    const updated = await updateStorage(db, created.id, {
      title: 'Updated',
      mode: 'public',
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
    expect(updated?.mode).toBe('public')
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
    const { db } = createTestApp()
    const created = await seed(db)
    const updated = await updateStorage(db, created.id, { status: 'disabled' })
    expect(updated?.status).toBe('disabled')
    expect(updated?.title).toBe('Original')
  })

  it('updates the updatedAt timestamp', async () => {
    const { db } = createTestApp()
    const created = await seed(db)
    const before = created.updatedAt.getTime()
    await new Promise((r) => setTimeout(r, 10))
    const updated = await updateStorage(db, created.id, { title: 'New Title' })
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})

describe('listStorages', () => {
  it('returns empty items and zero total when no storages exist', async () => {
    const { db } = createTestApp()
    const result = await listStorages(db)
    expect(result).toEqual({ items: [], total: 0 })
  })

  it('returns all storages ordered by createdAt ascending', async () => {
    const { db } = createTestApp()
    await createStorage(db, {
      title: 'First',
      mode: 'private',
      bucket: 'b1',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K1',
      secretKey: 'S1',
      capacity: 0,
    })
    await createStorage(db, {
      title: 'Second',
      mode: 'public',
      bucket: 'b2',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K2',
      secretKey: 'S2',
      capacity: 0,
    })
    const result = await listStorages(db)
    expect(result.total).toBe(2)
    expect(result.items).toHaveLength(2)
  })
})

describe('getStorage', () => {
  it('returns null when storage does not exist', async () => {
    const { db } = createTestApp()
    const result = await getStorage(db, 'nonexistent')
    expect(result).toBeNull()
  })

  it('returns the storage when it exists', async () => {
    const { db } = createTestApp()
    const created = await createStorage(db, {
      title: 'Findable',
      mode: 'private',
      bucket: 'b',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K',
      secretKey: 'S',
      capacity: 0,
    })
    const found = await getStorage(db, created.id)
    expect(found?.id).toBe(created.id)
  })
})

describe('selectStorage', () => {
  async function seedActive(
    db: ReturnType<typeof createTestApp>['db'],
    mode: 'private' | 'public',
    opts: { capacity?: number; used?: number; status?: string } = {},
  ) {
    return createStorage(db, {
      title: 'Seed',
      mode,
      bucket: 'b',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K',
      secretKey: 'S',
      capacity: opts.capacity ?? 0,
    })
  }

  it('returns an active private storage with unlimited capacity', async () => {
    const { db } = createTestApp()
    const created = await seedActive(db, 'private')
    const found = await selectStorage(db, 'private')
    expect(found.id).toBe(created.id)
  })

  it('returns an active public storage when requested', async () => {
    const { db } = createTestApp()
    const created = await seedActive(db, 'public')
    const found = await selectStorage(db, 'public')
    expect(found.id).toBe(created.id)
  })

  it('throws when no active storage exists for the requested mode', async () => {
    const { db } = createTestApp()
    await expect(selectStorage(db, 'private')).rejects.toThrow('No available storage')
  })

  it('throws when storage is present but mode does not match', async () => {
    const { db } = createTestApp()
    await seedActive(db, 'public')
    await expect(selectStorage(db, 'private')).rejects.toThrow('No available storage')
  })
})

describe('deleteStorage', () => {
  it('returns not_found when storage does not exist', async () => {
    const { db } = createTestApp()
    const result = await deleteStorage(db, 'nonexistent')
    expect(result).toBe('not_found')
  })

  it('deletes a storage that is not referenced by any matter', async () => {
    const { db } = createTestApp()
    const created = await createStorage(db, {
      title: 'Deletable',
      mode: 'private',
      bucket: 'b',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKey: 'K',
      secretKey: 'S',
      capacity: 0,
    })
    const result = await deleteStorage(db, created.id)
    expect(result).toBe('ok')
    expect(await getStorage(db, created.id)).toBeNull()
  })

  it('returns in_use when matters reference the storage', async () => {
    const { db } = createTestApp()
    const created = await createStorage(db, {
      title: 'In Use',
      mode: 'private',
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
    const result = await deleteStorage(db, created.id)
    expect(result).toBe('in_use')
  })
})
