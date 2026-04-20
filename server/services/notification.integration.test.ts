import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import {
  createNotification,
  listNotifications,
  markAllAsRead,
  markAsRead,
  unreadCount,
} from '../services/notification.js'
import { createTestApp } from '../test/setup.js'

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

    const n = await createNotification(db, { userId, type: 'share_received', title: 'You got a share' })

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

    const n = await createNotification(db, {
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

    const result = await listNotifications(db, userId, { page: 1, pageSize: 20 })

    expect(result.items).toHaveLength(0)
    expect(result.total).toBe(0)
    expect(result.unreadCount).toBe(0)
  })

  it('paginates correctly', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    for (let i = 0; i < 5; i++) {
      await createNotification(db, { userId, type: 'test', title: `Notification ${i}` })
    }

    const page1 = await listNotifications(db, userId, { page: 1, pageSize: 3 })
    expect(page1.items).toHaveLength(3)
    expect(page1.total).toBe(5)

    const page2 = await listNotifications(db, userId, { page: 2, pageSize: 3 })
    expect(page2.items).toHaveLength(2)
  })

  it('returns accurate unreadCount regardless of filter', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const n1 = await createNotification(db, { userId, type: 'test', title: 'A' })
    await createNotification(db, { userId, type: 'test', title: 'B' })
    await markAsRead(db, userId, n1.id)

    const result = await listNotifications(db, userId, { page: 1, pageSize: 20 })
    expect(result.total).toBe(2)
    expect(result.unreadCount).toBe(1)
  })

  it('filters unread only when requested', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const n1 = await createNotification(db, { userId, type: 'test', title: 'A' })
    await createNotification(db, { userId, type: 'test', title: 'B' })
    await markAsRead(db, userId, n1.id)

    const result = await listNotifications(db, userId, { page: 1, pageSize: 20, unreadOnly: true })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe('B')
  })

  it('isolates between users', async () => {
    const { db } = await createTestApp()
    const user1 = await insertUser(db)
    const user2 = await insertUser(db)

    await createNotification(db, { userId: user1, type: 'test', title: 'For user1' })

    const result = await listNotifications(db, user2, { page: 1, pageSize: 20 })
    expect(result.items).toHaveLength(0)
  })
})

describe('markAsRead', () => {
  it('marks a notification as read (idempotent)', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const n = await createNotification(db, { userId, type: 'test', title: 'Test' })

    const first = await markAsRead(db, userId, n.id)
    expect(first).toBe(true)

    const second = await markAsRead(db, userId, n.id)
    expect(second).toBe(true)

    const count = await unreadCount(db, userId)
    expect(count).toBe(0)
  })

  it('returns false for a cross-user attempt', async () => {
    const { db } = await createTestApp()
    const owner = await insertUser(db)
    const other = await insertUser(db)
    const n = await createNotification(db, { userId: owner, type: 'test', title: 'Test' })

    const result = await markAsRead(db, other, n.id)
    expect(result).toBe(false)

    const count = await unreadCount(db, owner)
    expect(count).toBe(1)
  })
})

describe('markAllAsRead', () => {
  it('marks all unread notifications and returns count', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    await createNotification(db, { userId, type: 'test', title: 'A' })
    await createNotification(db, { userId, type: 'test', title: 'B' })

    const result = await markAllAsRead(db, userId)
    expect(result.count).toBe(2)

    const count = await unreadCount(db, userId)
    expect(count).toBe(0)
  })

  it('only affects the requesting user', async () => {
    const { db } = await createTestApp()
    const user1 = await insertUser(db)
    const user2 = await insertUser(db)

    await createNotification(db, { userId: user1, type: 'test', title: 'A' })
    await createNotification(db, { userId: user2, type: 'test', title: 'B' })

    await markAllAsRead(db, user1)

    expect(await unreadCount(db, user1)).toBe(0)
    expect(await unreadCount(db, user2)).toBe(1)
  })

  it('returns 0 when nothing to mark', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const result = await markAllAsRead(db, userId)
    expect(result.count).toBe(0)
  })
})

describe('unreadCount', () => {
  it('returns correct count', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    expect(await unreadCount(db, userId)).toBe(0)

    const n = await createNotification(db, { userId, type: 'test', title: 'A' })
    await createNotification(db, { userId, type: 'test', title: 'B' })

    expect(await unreadCount(db, userId)).toBe(2)

    await markAsRead(db, userId, n.id)
    expect(await unreadCount(db, userId)).toBe(1)
  })
})
