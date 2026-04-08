import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup.js'
import { createStorage, deleteStorage, getStorage, listStorages, selectStorage, updateStorage } from './storage.js'

function makeStorageInput(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    title: 'Test Storage',
    mode: 'private' as const,
    bucket: 'bucket-1',
    endpoint: 'https://s3.amazonaws.com',
    region: 'auto',
    accessKey: 'AK',
    secretKey: 'SK',
    filePath: '$UID/$RAW_NAME',
    ...overrides,
  }
}

describe('StorageService', () => {
  it('creates and retrieves a storage', async () => {
    const { db } = createTestApp()
    const storage = await createStorage(db, makeStorageInput())
    expect(storage.id).toBeTruthy()
    expect(storage.status).toBe('active')
    expect(storage.capacity).toBe(0)

    const fetched = await getStorage(db, storage.id)
    expect(fetched).toBeDefined()
    expect(fetched!.title).toBe('Test Storage')
  })

  it('lists storages ordered by creation', async () => {
    const { db } = createTestApp()
    await createStorage(db, makeStorageInput({ title: 'First' }))
    await createStorage(db, makeStorageInput({ title: 'Second' }))

    const all = await listStorages(db)
    expect(all).toHaveLength(2)
    expect(all[0].title).toBe('First')
    expect(all[1].title).toBe('Second')
  })

  it('updates a storage', async () => {
    const { db } = createTestApp()
    const storage = await createStorage(db, makeStorageInput())

    const updated = await updateStorage(db, storage.id, { title: 'New Title', capacity: 1000 })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('New Title')
    expect(updated!.capacity).toBe(1000)
    expect(updated!.bucket).toBe('bucket-1')
  })

  it('update preserves existing fields when not provided', async () => {
    const { db } = createTestApp()
    const storage = await createStorage(db, makeStorageInput({ title: 'Original', capacity: 500 }))

    const updated = await updateStorage(db, storage.id, { status: 'disabled' })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('Original')
    expect(updated!.capacity).toBe(500)
    expect(updated!.status).toBe('disabled')
  })

  it('update returns null for missing storage', async () => {
    const { db } = createTestApp()
    const result = await updateStorage(db, 'nonexistent', { title: 'Nope' })
    expect(result).toBeNull()
  })

  it('deletes a storage', async () => {
    const { db } = createTestApp()
    const storage = await createStorage(db, makeStorageInput())
    const result = await deleteStorage(db, storage.id)
    expect(result).toBe('ok')

    const fetched = await getStorage(db, storage.id)
    expect(fetched).toBeUndefined()
  })

  it('delete returns not_found for missing storage', async () => {
    const { db } = createTestApp()
    const result = await deleteStorage(db, 'nonexistent')
    expect(result).toBe('not_found')
  })

  it('delete returns referenced when matters exist', async () => {
    const { db } = createTestApp()
    const storage = await createStorage(db, makeStorageInput())
    const now = Date.now()

    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, storage_id, created_at, updated_at)
      VALUES (${'m1'}, ${'org-1'}, ${'alias-1'}, ${'file.txt'}, ${'text/plain'}, ${storage.id}, ${now}, ${now})
    `)

    const result = await deleteStorage(db, storage.id)
    expect(result).toBe('referenced')
  })

  describe('selectStorage (pool selection)', () => {
    it('selects first available storage by creation order', async () => {
      const { db } = createTestApp()
      await createStorage(db, makeStorageInput({ title: 'S1', capacity: 100 }))
      await createStorage(db, makeStorageInput({ title: 'S2', capacity: 200 }))

      const selected = await selectStorage(db, 'private')
      expect(selected.title).toBe('S1')
    })

    it('skips full storages and selects next available', async () => {
      const { db } = createTestApp()
      const s1 = await createStorage(db, makeStorageInput({ title: 'Full', capacity: 100 }))
      await createStorage(db, makeStorageInput({ title: 'Available', capacity: 200 }))

      await db.run(sql`UPDATE storages SET used = 100 WHERE id = ${s1.id}`)

      const selected = await selectStorage(db, 'private')
      expect(selected.title).toBe('Available')
    })

    it('selects unlimited storage (capacity=0)', async () => {
      const { db } = createTestApp()
      await createStorage(db, makeStorageInput({ title: 'Unlimited', capacity: 0 }))

      const selected = await selectStorage(db, 'private')
      expect(selected.title).toBe('Unlimited')
    })

    it('throws when no storages available', async () => {
      const { db } = createTestApp()
      await expect(selectStorage(db, 'private')).rejects.toThrow('No available storage')
    })

    it('throws when all storages are full', async () => {
      const { db } = createTestApp()
      const s1 = await createStorage(db, makeStorageInput({ title: 'Full', capacity: 100 }))
      await db.run(sql`UPDATE storages SET used = 100 WHERE id = ${s1.id}`)

      await expect(selectStorage(db, 'private')).rejects.toThrow('No available storage')
    })

    it('ignores disabled storages', async () => {
      const { db } = createTestApp()
      await createStorage(db, makeStorageInput({ title: 'Active' }))
      const s2 = await createStorage(db, makeStorageInput({ title: 'Disabled' }))
      await db.run(sql`UPDATE storages SET status = 'disabled' WHERE id = ${s2.id}`)

      const selected = await selectStorage(db, 'private')
      expect(selected.title).toBe('Active')
    })

    it('only selects storages matching the requested mode', async () => {
      const { db } = createTestApp()
      await createStorage(db, makeStorageInput({ title: 'Private', mode: 'private' }))
      await createStorage(db, makeStorageInput({ title: 'Public', mode: 'public' }))

      const selected = await selectStorage(db, 'public')
      expect(selected.title).toBe('Public')
    })
  })
})
