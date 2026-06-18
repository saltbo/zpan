import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '../../db/auth-schema.js'
import { siteInvitations, systemOptions } from '../../db/schema.js'
import { adminHeaders, authedHeaders, createTestApp } from '../../test/setup.js'

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

  it('GET / returns 401 without auth [spec: site-invitations/admin-auth]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/invitations')
    expect(res.status).toBe(401)
  })

  it('POST / returns 403 for a non-admin user [spec: site-invitations/admin-only]', async () => {
    const { app } = await createTestApp()
    stubEmailProvider()
    await adminHeaders(app)
    const headers = await authedHeaders(app, 'regular@example.com')
    const res = await app.request('/api/site/invitations', {
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

  it('creates an invitation and returns 201 [spec: site-invitations/create]', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    const res = await ctx.app.request('/api/site/invitations', {
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

  it('lists invitations with total count [spec: site-invitations/list]', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    await ctx.app.request('/api/site/invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })

    const res = await ctx.app.request('/api/site/invitations', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ email: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]?.email).toBe('invitee@example.com')
  })

  it('resends an invitation and rotates the token [spec: site-invitations/resend]', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    const createRes = await ctx.app.request('/api/site/invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })
    const created = (await createRes.json()) as { id: string; token: string }

    const resendRes = await ctx.app.request(`/api/site/invitations/${created.id}/deliveries`, {
      method: 'POST',
      headers,
    })

    expect(resendRes.status).toBe(200)
    const resent = (await resendRes.json()) as { token: string }
    expect(resent.token).not.toBe(created.token)
  })

  it('revokes an invitation [spec: site-invitations/revoke]', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    const createRes = await ctx.app.request('/api/site/invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })
    const created = (await createRes.json()) as { id: string }

    const revokeRes = await ctx.app.request(`/api/site/invitations/${created.id}`, {
      method: 'DELETE',
      headers,
    })

    expect(revokeRes.status).toBe(204)
  })

  it('returns 409 when creating a duplicate pending invitation [spec: site-invitations/duplicate]', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    await ctx.app.request('/api/site/invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })

    const duplicateRes = await ctx.app.request('/api/site/invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invitee@example.com' }),
    })

    expect(duplicateRes.status).toBe(409)
    const body = (await duplicateRes.json()) as {
      error: { code: number; message: string; status: string; details: Array<{ reason: string }> }
    }
    expect(body.error.code).toBe(409)
    expect(body.error.message).toContain('pending invitation already exists')
    expect(body.error.status).toBe('ABORTED')
    expect(body.error.details[0].reason).toBe('ABORTED')
  })
})

// ─── resend/revoke state-machine guards ──────────────────────────────────────

describe('Admin Site Invitations API — resend/revoke guards', () => {
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

  async function createInvitation(ctx: Awaited<ReturnType<typeof createTestApp>>, email: string): Promise<string> {
    const headers = await adminHeaders(ctx.app)
    const res = await ctx.app.request('/api/site/invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return ((await res.json()) as { id: string }).id
  }

  it('resend returns 404 for an unknown invitation id', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    const res = await ctx.app.request('/api/site/invitations/does-not-exist/deliveries', {
      method: 'POST',
      headers,
    })

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Invitation not found')
    expect(body.error.status).toBe('NOT_FOUND')
  })

  it('resend returns 400 when the invitation was already accepted', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const id = await createInvitation(ctx, 'accepted-resend@example.com')
    await ctx.db
      .update(siteInvitations)
      .set({ acceptedBy: 'someone', acceptedAt: new Date() })
      .where(eq(siteInvitations.id, id))
    const headers = await adminHeaders(ctx.app)

    const res = await ctx.app.request(`/api/site/invitations/${id}/deliveries`, { method: 'POST', headers })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Invitation has already been used')
  })

  it('resend returns 400 when the invitation was revoked', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const id = await createInvitation(ctx, 'revoked-resend@example.com')
    await ctx.db
      .update(siteInvitations)
      .set({ revokedBy: 'someone', revokedAt: new Date() })
      .where(eq(siteInvitations.id, id))
    const headers = await adminHeaders(ctx.app)

    const res = await ctx.app.request(`/api/site/invitations/${id}/deliveries`, { method: 'POST', headers })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Invitation has been revoked')
  })

  it('revoke returns 404 for an unknown invitation id', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const headers = await adminHeaders(ctx.app)

    const res = await ctx.app.request('/api/site/invitations/does-not-exist', { method: 'DELETE', headers })

    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Invitation not found')
    expect(body.error.status).toBe('NOT_FOUND')
  })

  it('revoke returns 400 when the invitation was already accepted', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const id = await createInvitation(ctx, 'accepted-revoke@example.com')
    await ctx.db
      .update(siteInvitations)
      .set({ acceptedBy: 'someone', acceptedAt: new Date() })
      .where(eq(siteInvitations.id, id))
    const headers = await adminHeaders(ctx.app)

    const res = await ctx.app.request(`/api/site/invitations/${id}`, { method: 'DELETE', headers })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Invitation has already been used')
  })

  it('revoke returns 400 when the invitation was already revoked', async () => {
    const ctx = await createTestApp()
    stubEmailProvider()
    await seedEmailOptions(ctx)
    const id = await createInvitation(ctx, 'double-revoke@example.com')
    const headers = await adminHeaders(ctx.app)

    const first = await ctx.app.request(`/api/site/invitations/${id}`, { method: 'DELETE', headers })
    expect(first.status).toBe(204)

    const second = await ctx.app.request(`/api/site/invitations/${id}`, { method: 'DELETE', headers })
    expect(second.status).toBe(400)
    const body = (await second.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Invitation has already been revoked')
  })
})

describe('Public Site Invitations API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an invitation by token [spec: site-invitations/by-token]', async () => {
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

    const { createSiteInvitationRepo } = await import('../../adapters/repos/site-invitations.js')
    const invitation = await createSiteInvitationRepo(ctx.db).createSiteInvitation(admin.id, 'invitee@example.com')

    const res = await ctx.app.request(`/api/site/invitations/${invitation.token}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { email: string; token: string }
    expect(body.email).toBe('invitee@example.com')
    expect(body.token).toBe(invitation.token)
  })

  it('returns 404 for an unknown invitation token', async () => {
    const ctx = await createTestApp()
    const res = await ctx.app.request('/api/site/invitations/no-such-token')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: number; message: string; status: string } }
    expect(body.error.code).toBe(404)
    expect(body.error.message).toBe('Invitation not found')
    expect(body.error.status).toBe('NOT_FOUND')
  })
})
