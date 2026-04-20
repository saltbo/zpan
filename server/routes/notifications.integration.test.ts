import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createNotification } from '../services/notification.js'
import { createTestApp } from '../test/setup.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']
type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']

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

async function signUpAndGetUser(app: TestApp, email: string) {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'password123456' }),
  })
  const headers = { Cookie: res.headers.getSetCookie().join('; ') }
  const body = (await res.json()) as { user?: { id: string } }
  return { headers, userId: body.user?.id ?? '' }
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe('GET /api/notifications (auth guard)', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/notifications')
    expect(res.status).toBe(401)
  })
})

// ─── GET /api/notifications ───────────────────────────────────────────────────

describe('GET /api/notifications', () => {
  it('returns empty list for a new user', async () => {
    const { app } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    const res = await app.request('/api/notifications', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; unreadCount: number }
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
    expect(body.unreadCount).toBe(0)
  })

  it('returns notifications with pagination', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    for (let i = 0; i < 5; i++) {
      await createNotification(db, { userId, type: 'test', title: `Notification ${i}` })
    }

    const res = await app.request('/api/notifications?page=1&pageSize=3', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(body.items).toHaveLength(3)
    expect(body.total).toBe(5)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(3)
  })

  it('filters unread notifications', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    const n1 = await createNotification(db, { userId, type: 'test', title: 'Read' })
    await createNotification(db, { userId, type: 'test', title: 'Unread' })

    await app.request(`/api/notifications/${n1.id}/read`, { method: 'POST', headers })

    const res = await app.request('/api/notifications?unread=true', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ title: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].title).toBe('Unread')
  })

  it('does not return other users notifications', async () => {
    const { app, db } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const otherId = await insertUser(db)
    await createNotification(db, { userId: otherId, type: 'test', title: 'Other' })

    const res = await app.request('/api/notifications', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })
})

// ─── GET /api/notifications/unread-count ─────────────────────────────────────

describe('GET /api/notifications/unread-count', () => {
  it('returns correct count', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    await createNotification(db, { userId, type: 'test', title: 'A' })
    await createNotification(db, { userId, type: 'test', title: 'B' })

    const res = await app.request('/api/notifications/unread-count', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(2)
  })
})

// ─── POST /api/notifications/:id/read ────────────────────────────────────────

describe('POST /api/notifications/:id/read', () => {
  it('marks notification as read and returns 204', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const n = await createNotification(db, { userId, type: 'test', title: 'Test' })

    const res = await app.request(`/api/notifications/${n.id}/read`, { method: 'POST', headers })
    expect(res.status).toBe(204)

    const countRes = await app.request('/api/notifications/unread-count', { headers })
    const body = (await countRes.json()) as { count: number }
    expect(body.count).toBe(0)
  })

  it('is idempotent', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const n = await createNotification(db, { userId, type: 'test', title: 'Test' })

    await app.request(`/api/notifications/${n.id}/read`, { method: 'POST', headers })
    const res = await app.request(`/api/notifications/${n.id}/read`, { method: 'POST', headers })
    expect(res.status).toBe(204)
  })

  it('returns 404 for a notification owned by another user', async () => {
    const { app, db } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const otherId = await insertUser(db)
    const n = await createNotification(db, { userId: otherId, type: 'test', title: 'Other' })

    const res = await app.request(`/api/notifications/${n.id}/read`, { method: 'POST', headers })
    expect(res.status).toBe(404)
  })

  it('returns 404 for a non-existent id', async () => {
    const { app } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    const res = await app.request('/api/notifications/nonexistent/read', { method: 'POST', headers })
    expect(res.status).toBe(404)
  })
})

// ─── POST /api/notifications/read-all ────────────────────────────────────────

describe('POST /api/notifications/read-all', () => {
  it('marks all notifications as read and returns count', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    await createNotification(db, { userId, type: 'test', title: 'A' })
    await createNotification(db, { userId, type: 'test', title: 'B' })

    const res = await app.request('/api/notifications/read-all', { method: 'POST', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(2)

    const countRes = await app.request('/api/notifications/unread-count', { headers })
    const countBody = (await countRes.json()) as { count: number }
    expect(countBody.count).toBe(0)
  })

  it('only affects the current user', async () => {
    const { app, db } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const otherId = await insertUser(db)
    await createNotification(db, { userId: otherId, type: 'test', title: 'Other' })

    const res = await app.request('/api/notifications/read-all', { method: 'POST', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(0)
  })

  it('returns 0 when nothing to mark', async () => {
    const { app } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    const res = await app.request('/api/notifications/read-all', { method: 'POST', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(0)
  })
})
