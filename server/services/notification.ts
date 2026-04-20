import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { notifications } from '../db/schema'
import type { Database } from '../platform/interface'

export type Notification = typeof notifications.$inferSelect

export type CreateNotificationInput = {
  userId: string
  type: string
  title: string
  body?: string
  refType?: string
  refId?: string
  metadata?: string
}

export async function createNotification(db: Database, input: CreateNotificationInput): Promise<Notification> {
  const row: Notification = {
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
  return row
}

export type ListNotificationsResult = {
  items: Notification[]
  total: number
  unreadCount: number
}

export async function listNotifications(
  db: Database,
  userId: string,
  opts: { page: number; pageSize: number; unreadOnly?: boolean },
): Promise<ListNotificationsResult> {
  const { page, pageSize, unreadOnly } = opts
  const offset = (page - 1) * pageSize

  const baseCondition = unreadOnly
    ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
    : eq(notifications.userId, userId)

  const [items, totalRows, unreadRows] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(baseCondition)
      .orderBy(desc(notifications.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(notifications).where(baseCondition),
    db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ])

  return {
    items,
    total: totalRows[0]?.count ?? 0,
    unreadCount: unreadRows[0]?.count ?? 0,
  }
}

export async function markAsRead(db: Database, userId: string, id: string): Promise<boolean> {
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
}

export async function markAllAsRead(db: Database, userId: string): Promise<{ count: number }> {
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
}

export async function unreadCount(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))

  return rows[0]?.count ?? 0
}
