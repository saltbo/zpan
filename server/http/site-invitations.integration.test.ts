import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { systemOptions } from '../db/schema.js'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

function stubEmailProvider() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({}),
    }),
  )
}

describe('Admin Site Invitations API — auth guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET / returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/site-invitations')
    expect(res.status).toBe(401)
  })

  it('POST / returns 403 for a non-admin user', async () => {
    const { app } = await createTestApp()
    stubEmailProvider()
    await adminHeaders(app)
    const headers = await authedHeaders(app, 'regular@example.com')
    const res = await app.request('/api/admin/site-invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('Admin Site Invitations API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function seedEmailOptions(ctx: Awaited<ReturnType<typeof createTestApp>>) {
    await ctx.db.insert(systemOptions).values([
      { key: 'email_enabled', value: 'true' },
      { key: 'email_provider', value: 'http' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_http_url', value: 'https://mail.example.com/send' },
      { key: 'email_http_api_key', value: 'test-api-key' },
      { key: 'site_name', value: 'ZPan Test' },
    ])
  }

  it('creates an invitation and returns 201', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    const res = await ctx.app.request('/api/admin/site-invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { email: string; token: string; status: string }
    expect(body.email).toBe('invitee@example.com')
    expect(body.token).toBeTruthy()
    expect(body.status).toBe('pending')
  })

  it('lists invitations with total count', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    await ctx.app.request('/api/admin/site-invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })

    const res = await ctx.app.request('/api/admin/site-invitations', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ email: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]?.email).toBe('invitee@example.com')
  })

  it('resends an invitation and rotates the token', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    const createRes = await ctx.app.request('/api/admin/site-invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })
    const created = (await createRes.json()) as { id: string; token: string }

    const resendRes = await ctx.app.request(`/api/admin/site-invitations/${created.id}/resend`, {
      method: 'POST',
      headers,
    })

    expect(resendRes.status).toBe(200)
    const resent = (await resendRes.json()) as { token: string }
    expect(resent.token).not.toBe(created.token)
  })

  it('revokes an invitation', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    const createRes = await ctx.app.request('/api/admin/site-invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })
    const created = (await createRes.json()) as { id: string }

    const revokeRes = await ctx.app.request(`/api/admin/site-invitations/${created.id}`, {
      method: 'DELETE',
      headers,
    })

    expect(revokeRes.status).toBe(200)
    const body = (await revokeRes.json()) as { revoked: boolean }
    expect(body.revoked).toBe(true)
  })

  it('returns 409 when creating a duplicate pending invitation', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    await ctx.app.request('/api/admin/site-invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })

    const duplicateRes = await ctx.app.request('/api/admin/site-invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })

    expect(duplicateRes.status).toBe(409)
  })
})

describe('Public Site Invitations API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an invitation by token', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await ctx.db.insert(systemOptions).values([
      { key: 'email_enabled', value: 'true' },
      { key: 'email_provider', value: 'http' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_http_url', value: 'https://mail.example.com/send' },
      { key: 'email_http_api_key', value: 'test-api-key' },
    ])
    const headers = await adminHeaders(ctx.app)

    const [admin] = await ctx.db
      .select({ id: authSchema.user.id })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, 'admin@example.com'))
      .limit(1)

    const { createSiteInvitation } = await import('../services/site-invitations.js')
    const invitation = await createSiteInvitation(ctx.db, admin.id, 'invitee@example.com')

    const res = await ctx.app.request(`/api/site-invitations/${invitation.token}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { email: string; token: string }
    expect(body.email).toBe('invitee@example.com')
    expect(body.token).toBe(invitation.token)
  })
})
