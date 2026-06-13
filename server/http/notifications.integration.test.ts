import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { createNotificationRepo } from '../adapters/repos/notification.js'
import * as authSchema from '../db/auth-schema.js'
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
  it('returns 401 without auth [spec: notifications/auth]', async () => {
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

  it('returns notifications with pagination [spec: notifications/list]', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    for (let i = 0; i < 5; i++) {
      await createNotificationRepo(db).create({ userId, type: 'share_received', title: `Notification ${i}` })
    }

    const res = await app.request('/api/notifications?page=1&pageSize=3', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(body.items).toHaveLength(3)
    expect(body.total).toBe(5)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(3)
  })

  it('filters unread notifications [spec: notifications/unread-filter]', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    const n1 = await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'Read' })
    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'Unread' })

    await app.request(`/api/notifications/${n1.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })

    const res = await app.request('/api/notifications?unread=true', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ title: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].title).toBe('Unread')
  })

  it('does not return other users notifications [spec: notifications/isolation]', async () => {
    const { app, db } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const otherId = await insertUser(db)
    await createNotificationRepo(db).create({ userId: otherId, type: 'share_received', title: 'Other' })

    const res = await app.request('/api/notifications', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })
})

// ─── GET /api/notifications/stats ─────────────────────────────────────

describe('GET /api/notifications/stats', () => {
  it('returns correct count [spec: notifications/stats]', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'A' })
    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'B' })

    const res = await app.request('/api/notifications/stats', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(2)
  })
})

// ─── PATCH /api/notifications/:id ────────────────────────────────────────

describe('PATCH /api/notifications/:id', () => {
  it('marks notification as read and returns 204 [spec: notifications/mark-read]', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const n = await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'Test' })

    const res = await app.request(`/api/notifications/${n.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    expect(res.status).toBe(204)

    const countRes = await app.request('/api/notifications/stats', { headers })
    const body = (await countRes.json()) as { count: number }
    expect(body.count).toBe(0)
  })

  it('is idempotent', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const n = await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'Test' })

    await app.request(`/api/notifications/${n.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    const res = await app.request(`/api/notifications/${n.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    expect(res.status).toBe(204)
  })

  it('returns 404 for a notification owned by another user [spec: notifications/mark-read-foreign]', async () => {
    const { app, db } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const otherId = await insertUser(db)
    const n = await createNotificationRepo(db).create({ userId: otherId, type: 'share_received', title: 'Other' })

    const res = await app.request(`/api/notifications/${n.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 for a non-existent id', async () => {
    const { app } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    const res = await app.request('/api/notifications/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── PATCH /api/notifications ────────────────────────────────────────

describe('PATCH /api/notifications', () => {
  it('marks all notifications as read and returns count [spec: notifications/mark-all]', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'A' })
    await createNotificationRepo(db).create({ userId, type: 'share_received', title: 'B' })

    const res = await app.request('/api/notifications', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(2)

    const countRes = await app.request('/api/notifications/stats', { headers })
    const countBody = (await countRes.json()) as { count: number }
    expect(countBody.count).toBe(0)
  })

  it('only affects the current user', async () => {
    const { app, db } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)
    const otherId = await insertUser(db)
    await createNotificationRepo(db).create({ userId: otherId, type: 'share_received', title: 'Other' })

    const res = await app.request('/api/notifications', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(0)
  })

  it('returns 0 when nothing to mark', async () => {
    const { app } = await createTestApp()
    const { headers } = await signUpAndGetUser(app, `${nanoid()}@example.com`)

    const res = await app.request('/api/notifications', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(0)
  })
})
