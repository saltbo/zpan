import type { CreateStorageInput, UpdateStorageInput } from '@zpan/shared/schemas'
import { and, asc, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { matters, storages } from '../db/schema'
import type { Database } from '../platform/interface'

export class StorageService {
  constructor(private db: Database) {}

  async list() {
    const rows = await this.db.select().from(storages).orderBy(asc(storages.createdAt))
    return { items: rows, total: rows.length }
  }

  async getById(id: string) {
    const rows = await this.db.select().from(storages).where(eq(storages.id, id))
    return rows[0] ?? null
  }

  async create(input: CreateStorageInput, uid: string) {
    const now = new Date()
    const row = {
      id: nanoid(),
      uid,
      title: input.title,
      mode: input.mode,
      bucket: input.bucket,
      endpoint: input.endpoint,
      region: input.region,
      accessKey: input.accessKey,
      secretKey: input.secretKey,
      filePath: input.filePath,
      customHost: input.customHost ?? '',
      capacity: input.capacity,
      used: 0,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    }
    await this.db.insert(storages).values(row)
    return row
  }

  async update(id: string, input: UpdateStorageInput) {
    const existing = await this.getById(id)
    if (!existing) return null

    await this.db
      .update(storages)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(storages.id, id))
    return this.getById(id)
  }

  async delete(id: string) {
    const refs = await this.db.all<{ count: number }>(
      sql`SELECT COUNT(*) as count FROM ${matters} WHERE ${matters.storageId} = ${id}`,
    )
    if (refs[0].count > 0) {
      return { conflict: true as const }
    }

    const existing = await this.getById(id)
    if (!existing) return { notFound: true as const }

    await this.db.delete(storages).where(eq(storages.id, id))
    return { deleted: true as const }
  }

  async selectStorage(mode: 'private' | 'public') {
    const rows = await this.db
      .select()
      .from(storages)
      .where(and(eq(storages.mode, mode), eq(storages.status, 'active')))
      .orderBy(asc(storages.createdAt))

    const available = rows.find((s) => s.capacity === 0 || s.used < s.capacity)
    if (!available) {
      throw new Error('No available storage')
    }
    return available
  }
}
