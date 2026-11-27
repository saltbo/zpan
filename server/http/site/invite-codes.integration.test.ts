import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createInviteRepo } from '../../adapters/repos/invite.js'
import * as authSchema from '../../db/auth-schema.js'
import { adminHeaders, authedHeaders, createTestApp } from '../../test/setup.js'

// ─── Admin routes ─────────────────────────────────────────────────────────────

describe('Admin Invite Codes API — auth guards', () => {
  it('GET / returns 401 without auth [spec: invite-codes/admin-auth]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invite-codes')
    expect(res.status).toBe(401)
  })

  it('GET / returns 403 for a non-admin user [spec: invite-codes/admin-only]', async () => {
    const { app } = await createTestApp()
    await adminHeaders(app) // first user becomes admin
    const headers = await authedHeaders(app, 'regular@example.com')
    const res = await app.request('/api/site/invite-codes', { headers })
    expect(res.status).toBe(403)
  })

  it('POST / returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invite-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    })
    expect(res.status).toBe(401)
  })

  it('DELETE /:id returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invite-codes/someid', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

describe('Admin Invite Codes API — GET /', () => {
  it('returns an empty list when no codes exist', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/invite-codes', { headers })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [], nextPageToken: null })
  })

  it('returns created codes without a next page token', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/site/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 3 }),
    })

    const res = await app.request('/api/site/invite-codes', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; nextPageToken: string | null }
    expect(body.items).toHaveLength(3)
    expect(body.nextPageToken).toBeNull()
  })

  it('follows next page tokens through every code exactly once [spec: invite-codes/list]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/site/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 5 }),
    })

    const ids: string[] = []
    const sizes: number[] = []
    let token: string | null = null
    for (let i = 0; i < 5; i++) {
      const query = new URLSearchParams({ pageSize: '2' })
      if (token) query.set('pageToken', token)
      const res = await app.request(`/api/site/invite-codes?${query}`, { headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { items: Array<{ id: string }>; nextPageToken: string | null }
      sizes.push(body.items.length)
      ids.push(...body.items.map((item) => item.id))
      token = body.nextPageToken
      if (!token) break
    }
    expect(sizes).toEqual([2, 2, 1])
    expect(new Set(ids).size).toBe(5)
  })

  it('rejects a tampered page token and one reused with another page size', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    await app.request('/api/site/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 3 }),
    })
    const first = await app.request('/api/site/invite-codes?pageSize=2', { headers })
    const { nextPageToken } = (await first.json()) as { nextPageToken: string }

    const tampered = await app.request(`/api/site/invite-codes?pageSize=2&pageToken=${nextPageToken}x`, { headers })
    expect(tampered.status).toBe(400)
    const resized = await app.request(`/api/site/invite-codes?pageSize=1&pageToken=${nextPageToken}`, { headers })
    expect(resized.status).toBe(400)
    expect(await resized.json()).toMatchObject({ error: { details: [{ reason: 'INVALID_PAGE_TOKEN' }] } })
  })
})

describe('Admin Invite Codes API — POST /', () => {
  it('creates the requested number of codes and returns 201 [spec: invite-codes/generate]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 4 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { codes: unknown[] }
    expect(body.codes).toHaveLength(4)
  })

  it('creates codes with an expiry when expiresInDays is provided [spec: invite-codes/generate-expiry]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, expiresInDays: 7 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { codes: Array<{ expiresAt: string | null }> }
    expect(body.codes[0].expiresAt).not.toBeNull()
  })

  it('returns 400 when count is missing', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when count exceeds maximum of 100 [spec: invite-codes/generate-limit]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 101 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when count is zero', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 0 }),
    })
    expect(res.status).toBe(400)
  })
})

describe('Admin Invite Codes API — DELETE /:id', () => {
  it('deletes an unused code and returns 204 [spec: invite-codes/delete]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const [row] = await createInviteRepo(db).generate('admin-user', 1)

    const res = await app.request(`/api/site/invite-codes/${row.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(204)
  })

  it('returns 404 for a nonexistent code id', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/invite-codes/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('returns 409 when trying to delete an already-used code [spec: invite-codes/delete-used]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const [row] = await createInviteRepo(db).generate('admin-user', 1)
    await createInviteRepo(db).redeem(row.code, 'user-123')

    const res = await app.request(`/api/site/invite-codes/${row.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(409)
  })
})

// ─── Public routes ────────────────────────────────────────────────────────────

describe('Public Invite Codes API — POST /validate', () => {
  it('returns valid:true for a valid unused code [spec: invite-codes/validate]', async () => {
    const { app, db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)

    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: row.code }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { valid: boolean }
    expect(body.valid).toBe(true)
  })

  it('returns valid:false for a nonexistent code', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NOSUCHCOD1' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { valid: boolean; error?: string }
    expect(body.valid).toBe(false)
    expect(body.error).toBeTruthy()
  })

  it('returns valid:false for a used code', async () => {
    const { app, db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)
    await createInviteRepo(db).redeem(row.code, 'user-99')

    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: row.code }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { valid: boolean }
    expect(body.valid).toBe(false)
  })

  it('returns valid:false for an expired code', async () => {
    const { app, db } = await createTestApp()
    const past = new Date(Date.now() - 1000)
    const [row] = await createInviteRepo(db).generate('admin-1', 1, past)

    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: row.code }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { valid: boolean }
    expect(body.valid).toBe(false)
  })

  it('returns 400 when code field is missing from request body', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when code is an empty string', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when code contains punctuation', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABCD_12345' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when code is fewer than 10 characters', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when code is more than 10 characters', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABCD1234567' }),
    })
    expect(res.status).toBe(400)
  })

  it('is accessible without authentication', async () => {
    const { app, db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)

    // No auth headers — should still work
    const res = await app.request('/api/site/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: row.code }),
    })
    expect(res.status).toBe(200)
  })
})

describe('Admin Invite Codes API — redeeming user', () => {
  it('names the redeeming user and omits them once deleted [spec: invite-codes/list-redeemer]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await authedHeaders(app, 'redeemer@example.com')
    const [redeemer] = await db.select().from(authSchema.user).where(eq(authSchema.user.email, 'redeemer@example.com'))

    const repo = createInviteRepo(db)
    const [kept, orphaned, unused] = await repo.generate('admin-1', 3)
    await repo.redeem(kept.code, redeemer.id)
    await repo.redeem(orphaned.code, 'deleted-user-id')

    const res = await app.request('/api/site/invite-codes', { headers })
    expect(res.status).toBe(200)
    const { items } = (await res.json()) as { items: Array<Record<string, unknown>> }
    const byId = new Map(items.map((item) => [item.id, item]))

    expect(byId.get(kept.id)).toMatchObject({
      usedBy: redeemer.id,
      usedByUser: { name: 'Test User', email: 'redeemer@example.com' },
    })
    expect(byId.get(orphaned.id)).toMatchObject({ usedBy: 'deleted-user-id' })
    expect(byId.get(orphaned.id)).not.toHaveProperty('usedByUser')
    expect(byId.get(unused.id)).toMatchObject({ usedBy: null })
    expect(byId.get(unused.id)).not.toHaveProperty('usedByUser')
  })
})
