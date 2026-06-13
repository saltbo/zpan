import type { AnnouncementInput } from '@shared/schemas'
import { count, desc, eq, ne } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { announcements } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { AnnouncementRecord, AnnouncementRepo } from '../../usecases/ports'

type AnnouncementRow = typeof announcements.$inferSelect

function toRecord(row: AnnouncementRow): AnnouncementRecord {
  return row as AnnouncementRecord
}

function pageParams(page: number, pageSize: number) {
  return { limit: pageSize, offset: (page - 1) * pageSize }
}

function publishedAtFor(input: AnnouncementInput, existing?: AnnouncementRow): Date | null {
  if (input.status === 'archived') return existing?.publishedAt ?? null
  if (input.status !== 'published') return null
  return existing?.publishedAt ?? new Date()
}

export function createAnnouncementRepo(db: Database): AnnouncementRepo {
  async function getRow(id: string): Promise<AnnouncementRow | null> {
    const rows = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1)
    return rows[0] ?? null
  }

  return {
    async create(input, createdBy) {
      const now = new Date()
      const row: AnnouncementRow = {
        id: nanoid(),
        title: input.title,
        body: input.body,
        status: input.status,
        priority: input.priority,
        publishedAt: publishedAtFor(input),
        expiresAt: null,
        createdBy,
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(announcements).values(row)
      return toRecord(row)
    },

    async listAdmin(opts) {
      const { limit, offset } = pageParams(opts.page, opts.pageSize)
      const where = opts.status ? eq(announcements.status, opts.status) : undefined
      const [items, totalRows] = await Promise.all([
        db
          .select()
          .from(announcements)
          .where(where)
          .orderBy(desc(announcements.priority), desc(announcements.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(announcements).where(where),
      ])
      return { items: items.map(toRecord), total: totalRows[0]?.count ?? 0, page: opts.page, pageSize: opts.pageSize }
    },

    async get(id) {
      const row = await getRow(id)
      return row ? toRecord(row) : null
    },

    async update(id, input) {
      const existing = await getRow(id)
      if (!existing) return null

      await db
        .update(announcements)
        .set({
          title: input.title,
          body: input.body,
          status: input.status,
          priority: input.priority,
          publishedAt: publishedAtFor(input, existing),
          updatedAt: new Date(),
        })
        .where(eq(announcements.id, id))

      const updated = await getRow(id)
      return updated ? toRecord(updated) : null
    },

    async delete(id) {
      const existing = await getRow(id)
      if (!existing) return false
      await db.delete(announcements).where(eq(announcements.id, id))
      return true
    },

    async listUser(opts) {
      const { limit, offset } = pageParams(opts.page, opts.pageSize)
      const baseCondition = opts.activeOnly ? eq(announcements.status, 'published') : ne(announcements.status, 'draft')
      const [items, totalRows] = await Promise.all([
        db
          .select()
          .from(announcements)
          .where(baseCondition)
          .orderBy(desc(announcements.priority), desc(announcements.publishedAt), desc(announcements.updatedAt))
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(announcements).where(baseCondition),
      ])
      return { items: items.map(toRecord), total: totalRows[0]?.count ?? 0, page: opts.page, pageSize: opts.pageSize }
    },
  }
}
