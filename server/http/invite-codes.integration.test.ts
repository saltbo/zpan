import { describe, expect, it } from 'vitest'
import { createInviteRepo } from '../adapters/repos/invite.js'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

// ─── Admin routes ─────────────────────────────────────────────────────────────

describe('Admin Invite Codes API — auth guards', () => {
  it('GET / returns 401 without auth [spec: invite-codes/admin-auth]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/invite-codes')
    expect(res.status).toBe(401)
  })

  it('GET / returns 403 for a non-admin user [spec: invite-codes/admin-only]', async () => {
    const { app } = await createTestApp()
    await adminHeaders(app) // first user becomes admin
    const headers = await authedHeaders(app, 'regular@example.com')
    const res = await app.request('/api/invite-codes', { headers })
    expect(res.status).toBe(403)
  })

  it('POST / returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/invite-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    })
    expect(res.status).toBe(401)
  })

  it('DELETE /:id returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/invite-codes/someid', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

describe('Admin Invite Codes API — GET /', () => {
  it('returns an empty list when no codes exist', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/invite-codes', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('returns created codes with correct total [spec: invite-codes/list]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 3 }),
    })

    const res = await app.request('/api/invite-codes', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.total).toBe(3)
    expect(body.items).toHaveLength(3)
  })

  it('paginates with page and pageSize query params', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 5 }),
    })

    const res = await app.request('/api/invite-codes?page=2&pageSize=3', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.total).toBe(5)
    expect(body.items).toHaveLength(2)
  })
})

describe('Admin Invite Codes API — POST /', () => {
  it('creates the requested number of codes and returns 201 [spec: invite-codes/generate]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/invite-codes', {
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
    const res = await app.request('/api/invite-codes', {
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
    const res = await app.request('/api/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when count exceeds maximum of 100 [spec: invite-codes/generate-limit]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 101 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when count is zero', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 0 }),
    })
    expect(res.status).toBe(400)
  })
})

describe('Admin Invite Codes API — DELETE /:id', () => {
  it('deletes an unused code and returns deleted:true [spec: invite-codes/delete]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const [row] = await createInviteRepo(db).generate('admin-user', 1)

    const res = await app.request(`/api/invite-codes/${row.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; deleted: boolean }
    expect(body.deleted).toBe(true)
    expect(body.id).toBe(row.id)
  })

  it('returns 404 for a nonexistent code id', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/invite-codes/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when trying to delete an already-used code [spec: invite-codes/delete-used]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const [row] = await createInviteRepo(db).generate('admin-user', 1)
    await createInviteRepo(db).redeem(row.code, 'user-123')

    const res = await app.request(`/api/invite-codes/${row.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(400)
  })
})

// ─── Public routes ────────────────────────────────────────────────────────────

describe('Public Invite Codes API — POST /validate', () => {
  it('returns valid:true for a valid unused code [spec: invite-codes/validate]', async () => {
    const { app, db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)

    const res = await app.request('/api/invite-codes/validations', {
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
    const res = await app.request('/api/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NOSUCHCD' }),
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

    const res = await app.request('/api/invite-codes/validations', {
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

    const res = await app.request('/api/invite-codes/validations', {
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
    const res = await app.request('/api/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when code is an empty string', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when code contains lowercase letters', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'abcd1234' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when code is fewer than 8 characters', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when code is more than 8 characters', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABCD12345' }),
    })
    expect(res.status).toBe(400)
  })

  it('is accessible without authentication', async () => {
    const { app, db } = await createTestApp()
    const [row] = await createInviteRepo(db).generate('admin-1', 1)

    // No auth headers — should still work
    const res = await app.request('/api/invite-codes/validations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: row.code }),
    })
    expect(res.status).toBe(200)
  })
})
