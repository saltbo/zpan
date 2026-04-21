import { describe, expect, it } from 'vitest'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

const githubConfig = {
  type: 'builtin' as const,
  clientId: 'client-id-123',
  clientSecret: 'super-secret-value',
  enabled: true,
}

const oidcConfig = {
  type: 'oidc' as const,
  clientId: 'oidc-client-id',
  clientSecret: 'oidc-secret-value',
  enabled: true,
  discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
  scopes: ['openid', 'email', 'profile'],
}

async function putProvider(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  headers: Record<string, string>,
  providerId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/admin/auth-providers/${providerId}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Auth Providers — public list', () => {
  it('returns empty items when no providers are configured', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/auth-providers')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toEqual([])
  })

  it('returns only enabled providers', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', { ...githubConfig, enabled: true })
    await putProvider(app, admin, 'google', { ...githubConfig, clientId: 'google-id', enabled: false })

    const res = await app.request('/api/auth-providers')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].providerId).toBe('github')
  })

  it('does not include clientSecret in public response', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)

    const res = await app.request('/api/auth-providers')
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0]).not.toHaveProperty('clientSecret')
  })

  it('returns display name and icon from provider metadata', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)

    const res = await app.request('/api/auth-providers')
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0].name).toBe('GitHub')
    expect(body.items[0].icon).toBe('github')
  })

  it('uses providerId as fallback name and icon for unknown OIDC provider', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'my-custom-oidc', oidcConfig)

    const res = await app.request('/api/auth-providers')
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(1)
    // No entry in OAuthProviderMeta for 'my-custom-oidc', so falls back to providerId
    expect(body.items[0].name).toBe('my-custom-oidc')
    expect(body.items[0].icon).toBe('my-custom-oidc')
  })

  it('disabled provider does not appear in public list', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', { ...githubConfig, enabled: false })

    const res = await app.request('/api/auth-providers')
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })
})

describe('Auth Providers — admin list', () => {
  it('returns 401 without authentication', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/auth-providers')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin user', async () => {
    const { app } = await createTestApp()
    // First sign-up makes admin; second is regular user
    await adminHeaders(app)
    await authedHeaders(app, 'regular@example.com') // registers the second user
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const freshHeaders = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/admin/auth-providers', { headers: freshHeaders })
    expect(res.status).toBe(403)
  })

  it('returns empty items when no providers are configured', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)
    const res = await app.request('/api/admin/auth-providers', { headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toEqual([])
  })

  it('returns all configs including disabled providers', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', { ...githubConfig, enabled: true })
    await putProvider(app, admin, 'google', { ...githubConfig, clientId: 'google-id', enabled: false })

    const res = await app.request('/api/admin/auth-providers', { headers: admin })
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(2)
  })

  it('masks clientSecret leaving only last 4 chars visible', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)

    const res = await app.request('/api/admin/auth-providers', { headers: admin })
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    const secret = body.items[0].clientSecret as string
    expect(secret).toMatch(/^\*+alue$/)
    expect(secret).not.toBe(githubConfig.clientSecret)
  })

  it('masks short secret entirely with four asterisks', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', { ...githubConfig, clientSecret: 'abc' })

    const res = await app.request('/api/admin/auth-providers', { headers: admin })
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0].clientSecret).toBe('****')
  })
})

describe('Auth Providers — admin upsert (PUT)', () => {
  it('returns 401 without authentication', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/auth-providers/github', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(githubConfig),
    })
    expect(res.status).toBe(401)
  })

  it('admin can create a builtin provider', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await putProvider(app, admin, 'github', githubConfig)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.providerId).toBe('github')
    expect(body.type).toBe('builtin')
    expect(body.clientId).toBe(githubConfig.clientId)
    expect(body.enabled).toBe(true)
  })

  it('returns masked secret on create response', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await putProvider(app, admin, 'github', githubConfig)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.clientSecret).not.toBe(githubConfig.clientSecret)
    expect((body.clientSecret as string).endsWith('alue')).toBe(true)
  })

  it('updates an existing provider on second PUT', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)
    const res = await putProvider(app, admin, 'github', { ...githubConfig, clientId: 'new-client-id', enabled: false })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.clientId).toBe('new-client-id')
    expect(body.enabled).toBe(false)

    // Admin list should still have only one entry
    const listRes = await app.request('/api/admin/auth-providers', { headers: admin })
    const listBody = (await listRes.json()) as { items: unknown[] }
    expect(listBody.items).toHaveLength(1)
  })

  it('admin can create an OIDC provider with discoveryUrl', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await putProvider(app, admin, 'my-oidc', oidcConfig)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.providerId).toBe('my-oidc')
    expect(body.type).toBe('oidc')
    expect(body.discoveryUrl).toBe(oidcConfig.discoveryUrl)
    expect(body.scopes).toEqual(oidcConfig.scopes)
  })

  it('returns 400 for unknown builtin provider ID', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await putProvider(app, admin, 'not-a-real-provider', githubConfig)
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toMatch(/Unknown builtin provider/)
  })

  it('returns 400 for OIDC provider missing discoveryUrl', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const { discoveryUrl: _, ...oidcWithoutDiscovery } = oidcConfig
    const res = await putProvider(app, admin, 'my-oidc', oidcWithoutDiscovery)
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toMatch(/discoveryUrl is required/)
  })

  it('returns 400 when clientId is missing', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const { clientId: _, ...withoutClientId } = githubConfig
    const res = await putProvider(app, admin, 'github', withoutClientId)
    expect(res.status).toBe(400)
  })

  it('returns 400 when clientSecret is empty string', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await putProvider(app, admin, 'github', { ...githubConfig, clientSecret: '' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when type is invalid', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await putProvider(app, admin, 'github', { ...githubConfig, type: 'unknown-type' })
    expect(res.status).toBe(400)
  })
})

describe('Auth Providers — admin delete', () => {
  it('returns 401 without authentication', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/auth-providers/github', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('admin can delete a provider', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)

    const res = await app.request('/api/admin/auth-providers/github', { method: 'DELETE', headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
    expect(body.providerId).toBe('github')
  })

  it('deleted provider no longer appears in public list', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)
    await app.request('/api/admin/auth-providers/github', { method: 'DELETE', headers: admin })

    const res = await app.request('/api/auth-providers')
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })

  it('deleted provider no longer appears in admin list', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)
    await app.request('/api/admin/auth-providers/github', { method: 'DELETE', headers: admin })

    const res = await app.request('/api/admin/auth-providers', { headers: admin })
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })

  it('deleting a non-existent provider returns 200 with deleted flag', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await app.request('/api/admin/auth-providers/github', { method: 'DELETE', headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
  })
})
