import { describe, expect, it } from 'vitest'
import { adminHeaders, authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'

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
  return app.request(`/api/auth-providers/${providerId}`, {
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

  it('returns only enabled providers [spec: auth-providers/public-enabled-only]', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)
    await seedProLicense(db) // 2nd provider requires social_login_unlimited

    await putProvider(app, admin, 'github', { ...githubConfig, enabled: true })
    await putProvider(app, admin, 'google', { ...githubConfig, clientId: 'google-id', enabled: false })

    const res = await app.request('/api/auth-providers')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].providerId).toBe('github')
  })

  it('does not include clientSecret in public response [spec: auth-providers/public-no-secret]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)

    const res = await app.request('/api/auth-providers')
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0]).not.toHaveProperty('clientSecret')
  })

  it('returns display name and icon from provider metadata [spec: auth-providers/metadata]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)

    const res = await app.request('/api/auth-providers')
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0].name).toBe('GitHub')
    expect(body.items[0].icon).toBe('github')
  })

  it('uses providerId as fallback name and icon for unknown OIDC provider [spec: auth-providers/oidc-fallback]', async () => {
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
  it('serves the public (secret-free) list to anonymous callers [spec: auth-providers/anon-public-list]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)
    await putProvider(app, admin, 'github', githubConfig)

    // No auth → public list, never the admin (secret-bearing) view.
    const res = await app.request('/api/auth-providers')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).not.toHaveProperty('clientSecret')
  })

  it('serves the public (secret-free) list to non-admin users [spec: auth-providers/admin-only]', async () => {
    const { app } = await createTestApp()
    // First sign-up makes admin; second is regular user
    const admin = await adminHeaders(app)
    await putProvider(app, admin, 'github', githubConfig)
    await authedHeaders(app, 'regular@example.com') // registers the second user
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const freshHeaders = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/auth-providers', { headers: freshHeaders })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).not.toHaveProperty('clientSecret')
  })

  it('returns empty items when no providers are configured', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)
    const res = await app.request('/api/auth-providers', { headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toEqual([])
  })

  it('returns all configs including disabled providers [spec: auth-providers/admin-list-all]', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)
    await seedProLicense(db) // 2nd provider requires social_login_unlimited

    await putProvider(app, admin, 'github', { ...githubConfig, enabled: true })
    await putProvider(app, admin, 'google', { ...githubConfig, clientId: 'google-id', enabled: false })

    const res = await app.request('/api/auth-providers', { headers: admin })
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(2)
  })

  it('masks clientSecret leaving only last 4 chars visible [spec: auth-providers/mask-secret]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)

    const res = await app.request('/api/auth-providers', { headers: admin })
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    const secret = body.items[0].clientSecret as string
    expect(secret).toMatch(/^\*+alue$/)
    expect(secret).not.toBe(githubConfig.clientSecret)
  })

  it('masks short secret entirely with four asterisks [spec: auth-providers/mask-short-secret]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', { ...githubConfig, clientSecret: 'abc' })

    const res = await app.request('/api/auth-providers', { headers: admin })
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0].clientSecret).toBe('****')
  })
})

describe('Auth Providers — admin upsert (PUT)', () => {
  it('returns 401 without authentication', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/auth-providers/github', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(githubConfig),
    })
    expect(res.status).toBe(401)
  })

  it('admin can create a builtin provider [spec: auth-providers/create-builtin]', async () => {
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

  it('blocks the second provider on the free plan with 402 [spec: auth-providers/free-limit]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const first = await putProvider(app, admin, 'github', githubConfig)
    expect(first.status).toBe(200)

    const second = await putProvider(app, admin, 'google', { ...githubConfig, clientId: 'google-id' })
    expect(second.status).toBe(402)
    const body = (await second.json()) as Record<string, unknown>
    expect(body.feature).toBe('social_login_unlimited')
    expect(body.limit).toBe(1)
  })

  it('allows additional providers with the social_login_unlimited entitlement [spec: auth-providers/unlimited-entitlement]', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)
    await seedProLicense(db)

    expect((await putProvider(app, admin, 'github', githubConfig)).status).toBe(200)
    expect((await putProvider(app, admin, 'google', { ...githubConfig, clientId: 'google-id' })).status).toBe(200)
  })

  it('updating the only provider is not blocked by the free limit [spec: auth-providers/update-not-limited]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)
    const res = await putProvider(app, admin, 'github', { ...githubConfig, clientId: 'updated' })
    expect(res.status).toBe(200)
  })

  it('returns masked secret on create response', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await putProvider(app, admin, 'github', githubConfig)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.clientSecret).not.toBe(githubConfig.clientSecret)
    expect((body.clientSecret as string).endsWith('alue')).toBe(true)
  })

  it('updates an existing provider on second PUT [spec: auth-providers/update]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)
    const res = await putProvider(app, admin, 'github', { ...githubConfig, clientId: 'new-client-id', enabled: false })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.clientId).toBe('new-client-id')
    expect(body.enabled).toBe(false)

    // Admin list should still have only one entry
    const listRes = await app.request('/api/auth-providers', { headers: admin })
    const listBody = (await listRes.json()) as { items: unknown[] }
    expect(listBody.items).toHaveLength(1)
  })

  it('admin can create an OIDC provider with discoveryUrl [spec: auth-providers/create-oidc]', async () => {
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

  it('returns 400 for unknown builtin provider ID [spec: auth-providers/unknown-builtin]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await putProvider(app, admin, 'not-a-real-provider', githubConfig)
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toMatch(/Unknown builtin provider/)
  })

  it('returns 400 for OIDC provider missing discoveryUrl [spec: auth-providers/oidc-missing-discovery]', async () => {
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
    const res = await app.request('/api/auth-providers/github', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('admin can delete a provider', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)

    const res = await app.request('/api/auth-providers/github', { method: 'DELETE', headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
    expect(body.providerId).toBe('github')
  })

  it('deleted provider no longer appears in public list', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)
    await app.request('/api/auth-providers/github', { method: 'DELETE', headers: admin })

    const res = await app.request('/api/auth-providers')
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })

  it('deleted provider no longer appears in admin list', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putProvider(app, admin, 'github', githubConfig)
    await app.request('/api/auth-providers/github', { method: 'DELETE', headers: admin })

    const res = await app.request('/api/auth-providers', { headers: admin })
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toHaveLength(0)
  })

  it('deleting a non-existent provider returns 200 with deleted flag', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await app.request('/api/auth-providers/github', { method: 'DELETE', headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
  })
})
