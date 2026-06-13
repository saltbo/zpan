import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../../db/auth-schema.js'
import { createTestApp } from '../../test/setup.js'
import { createNotificationRepo } from './notification.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function insertUser(db: TestDb, overrides: Partial<{ id: string; email: string }> = {}) {
  const id = overrides.id ?? nanoid()
  await db.insert(authSchema.user).values({
    id,
    name: 'Test User',
    email: overrides.email ?? `${id}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

describe('createNotification', () => {
  it('writes a row and returns it', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const n = await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'You got a share' })

    expect(n.id).toBeDefined()
    expect(n.userId).toBe(userId)
    expect(n.type).toBe('share_received')
    expect(n.title).toBe('You got a share')
    expect(n.body).toBe('')
    expect(n.readAt).toBeNull()
    expect(n.createdAt).toBeInstanceOf(Date)
  })

  it('stores optional fields', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const n = await createNotificationRepo(db).create({
      userId,
      type: 'share_received',
      title: 'Test',
      body: 'body text',
      refType: 'share',
      refId: 'ref-1',
      metadata: JSON.stringify({ token: 'abc' }),
    })

    expect(n.body).toBe('body text')
    expect(n.refType).toBe('share')
    expect(n.refId).toBe('ref-1')
    expect(n.metadata).toBe(JSON.stringify({ token: 'abc' }))
  })
})

describe('listNotifications', () => {
  it('returns empty list for new user', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const result = await createNotificationRepo(db).list(userId, { page: 1, pageSize: 20 })

    expect(result.items).toHaveLength(0)
    expect(result.total).toBe(0)
    expect(result.unreadCount).toBe(0)
  })

  it('paginates correctly', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    for (let i = 0; i < 5; i++) {
      await createNotificationRepo(db).create({ userId, type: 'share_received', title: `Notification ${i}` })
    }

    const page1 = await createNotificationRepo(db).list(userId, { page: 1, pageSize: 3 })
    expect(page1.items).toHaveLength(3)
    expect(page1.total).toBe(5)

    const page2 = await createNotificationRepo(db).list(userId, { page: 2, pageSize: 3 })
    expect(page2.items).toHaveLength(2)
  })

  it('returns accurate unreadCount regardless of filter', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const n1 = await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'A' })
    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'B' })
    await createNotificationRepo(db).markAsRead(userId, n1.id)

    const result = await createNotificationRepo(db).list(userId, { page: 1, pageSize: 20 })
    expect(result.total).toBe(2)
    expect(result.unreadCount).toBe(1)
  })

  it('filters unread only when requested', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const n1 = await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'A' })
    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'B' })
    await createNotificationRepo(db).markAsRead(userId, n1.id)

    const result = await createNotificationRepo(db).list(userId, { page: 1, pageSize: 20, unreadOnly: true })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe('B')
  })

  it('isolates between users', async () => {
    const { db } = await createTestApp()
    const user1 = await insertUser(db)
    const user2 = await insertUser(db)

    await createNotificationRepo(db).create({ userId: user1, type: 'share_received', title: 'For user1' })

    const result = await createNotificationRepo(db).list(user2, { page: 1, pageSize: 20 })
    expect(result.items).toHaveLength(0)
  })
})

describe('markAsRead', () => {
  it('marks a notification as read (idempotent)', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const n = await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'Test' })

    const first = await createNotificationRepo(db).markAsRead(userId, n.id)
    expect(first).toBe(true)

    const second = await createNotificationRepo(db).markAsRead(userId, n.id)
    expect(second).toBe(true)

    const count = await createNotificationRepo(db).unreadCount(userId)
    expect(count).toBe(0)
  })

  it('returns false for a cross-user attempt', async () => {
    const { db } = await createTestApp()
    const owner = await insertUser(db)
    const other = await insertUser(db)
    const n = await createNotificationRepo(db).create({ userId: owner, type: 'share_received', title: 'Test' })

    const result = await createNotificationRepo(db).markAsRead(other, n.id)
    expect(result).toBe(false)

    const count = await createNotificationRepo(db).unreadCount(owner)
    expect(count).toBe(1)
  })
})

describe('markAllAsRead', () => {
  it('marks all unread notifications and returns count', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'A' })
    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'B' })

    const result = await createNotificationRepo(db).markAllAsRead(userId)
    expect(result.count).toBe(2)

    const count = await createNotificationRepo(db).unreadCount(userId)
    expect(count).toBe(0)
  })

  it('only affects the requesting user', async () => {
    const { db } = await createTestApp()
    const user1 = await insertUser(db)
    const user2 = await insertUser(db)

    await createNotificationRepo(db).create({ userId: user1, type: 'share_received', title: 'A' })
    await createNotificationRepo(db).create({ userId: user2, type: 'share_received', title: 'B' })

    await createNotificationRepo(db).markAllAsRead(user1)

    expect(await createNotificationRepo(db).unreadCount(user1)).toBe(0)
    expect(await createNotificationRepo(db).unreadCount(user2)).toBe(1)
  })

  it('returns 0 when nothing to mark', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const result = await createNotificationRepo(db).markAllAsRead(userId)
    expect(result.count).toBe(0)
  })
})

describe('unreadCount', () => {
  it('returns correct count', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    expect(await createNotificationRepo(db).unreadCount(userId)).toBe(0)

    const n = await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'A' })
    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'B' })

    expect(await createNotificationRepo(db).unreadCount(userId)).toBe(2)

    await createNotificationRepo(db).markAsRead(userId, n.id)
    expect(await createNotificationRepo(db).unreadCount(userId)).toBe(1)
  })
})
