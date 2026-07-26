import { and, count, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { notifications } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { NotificationRecord, NotificationRepo } from '../../usecases/ports'

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
      await db.insert(notifications).values(row)
      return toRecord(row)
    },

    async list(userId, opts) {
      const { page, pageSize, unreadOnly } = opts
      const offset = (page - 1) * pageSize
      const baseCondition = unreadOnly
        ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
        : eq(notifications.userId, userId)

      const rows = await db
        .select({
          ...getTableColumns(notifications),
          pageTotal: sql<number>`COUNT(*) OVER()`.as('page_total'),
          pageUnread: sql<number>`SUM(CASE WHEN ${notifications.readAt} IS NULL THEN 1 ELSE 0 END) OVER()`.as(
            'page_unread',
          ),
        })
        .from(notifications)
        .where(baseCondition)
        .orderBy(desc(notifications.createdAt))
        .limit(pageSize)
        .offset(offset)

      let total = Number(rows[0]?.pageTotal ?? 0)
      let unreadCount = Number(rows[0]?.pageUnread ?? 0)
      if (rows.length === 0 && page > 1) {
        const summaryRows = await db
          .select({
            total: count(),
            unreadCount: sql<number>`SUM(CASE WHEN ${notifications.readAt} IS NULL THEN 1 ELSE 0 END)`,
          })
          .from(notifications)
          .where(eq(notifications.userId, userId))
        unreadCount = Number(summaryRows[0]?.unreadCount ?? 0)
        total = unreadOnly ? unreadCount : (summaryRows[0]?.total ?? 0)
      }
      return {
        items: rows.map(({ pageTotal: _, pageUnread: __, ...row }) => toRecord(row)),
        total,
        unreadCount,
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
        await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id))
      }
      return true
    },

    async markAllAsRead(userId) {
      const unread = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))

      if (unread.length === 0) return { count: 0 }

      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))

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
