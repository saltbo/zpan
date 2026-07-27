import { and, count, desc, eq, isNull, lt, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { notifications } from '../../db/schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import type { NotificationRecord, NotificationRepo } from '../../usecases/ports'
import { resourceChangeQuery } from './resource-change'

type NotificationRow = typeof notifications.$inferSelect

function toRecord(row: NotificationRow): NotificationRecord {
  return row as NotificationRecord
}

export function createNotificationRepo(db: Database): NotificationRepo {
  return {
    async create(input) {
      const row: NotificationRow = {
        id: nanoid(),
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        metadata: input.metadata ?? null,
        readAt: null,
        createdAt: new Date(),
      }
      await executeWriteTransaction(db, [
        db.insert(notifications).values(row),
        resourceChangeQuery(db, {
          scopeType: 'user',
          scopeId: input.userId,
          resourceType: 'notification',
          resourceId: row.id,
          changeType: 'upsert',
          action: 'created',
          occurredAt: row.createdAt,
        }),
      ])
      return toRecord(row)
    },

    async list(userId, opts) {
      const { pageSize, unreadOnly } = opts
      const conditions = [eq(notifications.userId, userId)]
      if (unreadOnly) conditions.push(isNull(notifications.readAt))
      if (opts.after) {
        conditions.push(
          or(
            lt(notifications.createdAt, opts.after.createdAt),
            and(eq(notifications.createdAt, opts.after.createdAt), lt(notifications.id, opts.after.id)),
          )!,
        )
      }

      const rows = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(pageSize + 1)
      const hasMore = rows.length > pageSize
      const page = hasMore ? rows.slice(0, pageSize) : rows
      const last = page.at(-1)
      return {
        items: page.map(toRecord),
        nextBoundary: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
      }
    },

    async markAsRead(userId, id) {
      const rows = await db
        .select({ id: notifications.id, readAt: notifications.readAt })
        .from(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .limit(1)

      if (!rows[0]) return false
      if (!rows[0].readAt) {
        const now = new Date()
        await executeWriteTransaction(db, [
          db.update(notifications).set({ readAt: now }).where(eq(notifications.id, id)),
          resourceChangeQuery(db, {
            scopeType: 'user',
            scopeId: userId,
            resourceType: 'notification',
            resourceId: id,
            changeType: 'upsert',
            action: 'read',
            occurredAt: now,
          }),
        ])
      }
      return true
    },

    async markAllAsRead(userId) {
      const unread = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))

      if (unread.length === 0) return { count: 0 }

      const now = new Date()
      await executeWriteTransaction(db, [
        db
          .update(notifications)
          .set({ readAt: now })
          .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
        resourceChangeQuery(db, {
          scopeType: 'user',
          scopeId: userId,
          resourceType: 'notification',
          resourceId: '*',
          changeType: 'upsert',
          action: 'read_all',
          metadata: { affectedCount: unread.length },
          occurredAt: now,
        }),
      ])

      return { count: unread.length }
    },

    async unreadCount(userId) {
      const rows = await db
        .select({ count: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      return rows[0]?.count ?? 0
    },
  }
}
