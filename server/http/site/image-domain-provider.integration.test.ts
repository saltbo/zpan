import { afterEach, describe, expect, it, vi } from 'vitest'
import { organization } from '../../db/auth-schema'
import { adminHeaders, createTestApp, seedProLicense } from '../../test/setup'

const manualSettings = {
  enabled: true,
  provider: 'manual',
  manual: {
    records: [
      { type: 'A', value: '192.0.2.10' },
      { type: 'AAAA', value: '2001:db8::10' },
    ],
  },
} as const

describe('Admin image-domain provider API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('requires an administrator for every provider operation', async () => {
    const { app } = await createTestApp()
    expect((await app.request('/api/site/settings/image-domains')).status).toBe(401)
    expect(
      (
        await app.request('/api/site/settings/image-domains', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(manualSettings),
        })
      ).status,
    ).toBe(401)
    expect((await app.request('/api/site/settings/image-domains/tests', { method: 'POST' })).status).toBe(401)
  })

  it('saves, tests, and reads a self-managed provider', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const empty = await app.request('/api/site/settings/image-domains', { headers })
    expect(empty.status).toBe(200)
    await expect(empty.json()).resolves.toMatchObject({
      settings: { enabled: false, provider: null },
      status: 'disabled',
      domains: [],
    })

    const saved = await app.request('/api/site/settings/image-domains', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(manualSettings),
    })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toEqual({ success: true, warning: null })

    const tested = await app.request('/api/site/settings/image-domains/tests', {
      method: 'POST',
      headers,
    })
    expect(tested.status).toBe(200)
    await expect(tested.json()).resolves.toEqual({ success: true })

    const current = await app.request('/api/site/settings/image-domains', { headers })
    expect(current.status).toBe(200)
    await expect(current.json()).resolves.toMatchObject({
      settings: manualSettings,
      status: 'ready',
      error: null,
    })
  })

  it('shows the stored provider error as a product message in the request language [spec: error-messages/image-domain-status]', async () => {
    const { app, db, deps } = await createTestApp()
    await seedProLicense(db)
    const headers = { ...(await adminHeaders(app)), 'Accept-Language': 'zh-CN' }
    await app.request('/api/site/settings/image-domains', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(manualSettings),
    })
    const read = async (error: string) => {
      await deps.systemOptions.setMany([{ key: 'image_domain_error', value: error }])
      const response = await app.request('/api/site/settings/image-domains', { headers })
      expect(response.headers.get('Vary')).toContain('Accept-Language')
      return ((await response.json()) as { status: string; error: string }).error
    }

    await db.insert(organization).values({ id: 'org-761', name: 'Images', slug: 'images-761', createdAt: new Date() })
    await deps.imageHostingConfigs.create({
      orgId: 'org-761',
      customDomain: 'img.example.com',
      domainProvider: 'manual',
      providerHostnameId: null,
      domainStatus: 'failed',
      domainError: 'custom hostname does not CNAME to this zone.',
      verificationToken: null,
      refererAllowlist: null,
    })

    // Stored before this rule: the provider's own text.
    await expect(read('fallback origin inactive')).resolves.toBe('自定义域名服务测试失败，请检查其设置。')
    const response = await app.request('/api/site/settings/image-domains', { headers })
    const body = (await response.json()) as { domains: Array<{ error: string | null }> }
    expect(body.domains.map((domain) => domain.error)).toEqual([
      '自定义域名尚未通过验证，请检查其 DNS 记录是否指向所示目标。',
    ])
    await expect(read('Turn on the Cloudflare proxy for the DNS record ssl.example.com')).resolves.toBe(
      '请为 DNS 记录 ssl.example.com 开启 Cloudflare 代理',
    )
  })

  it('switches away from a Cloudflare provider whose token no longer works [spec: image-hosting-config/switch-provider-cleanup-failure]', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = { ...(await adminHeaders(app)), 'Accept-Language': 'zh-CN', 'Content-Type': 'application/json' }
    const put = (body: unknown) =>
      app.request('/api/site/settings/image-domains', { method: 'PUT', headers, body: JSON.stringify(body) })
    expect(
      (
        await put({
          enabled: true,
          provider: 'cloudflare_saas',
          cloudflare: {
            apiToken: 'revoked-token',
            zoneId: '0123456789abcdef0123456789abcdef',
            routingMode: 'worker',
            workerName: 'zpan',
            cnameTarget: 'ssl.example.com',
          },
        })
      ).status,
    ).toBe(200)

    const cloudflare = vi.fn(async () =>
      Response.json({ success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] }, { status: 403 }),
    )
    vi.stubGlobal('fetch', cloudflare)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const saved = await put({
      enabled: true,
      provider: 'manual',
      manual: { records: [{ type: 'A', value: '192.0.2.10' }] },
    })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toEqual({
      success: true,
      warning: '无法移除之前的 Cloudflare 配置，请在 Cloudflare 中手动删除其自定义主机名、重写规则和 Worker 路由。',
    })
    expect(cloudflare).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid API Token'))

    const current = await app.request('/api/site/settings/image-domains', { headers })
    await expect(current.json()).resolves.toMatchObject({
      settings: { enabled: true, provider: 'manual', manual: { records: [{ type: 'A', value: '192.0.2.10' }] } },
    })
  })

  it('returns a validation error for an invalid manual DNS record', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const response = await app.request('/api/site/settings/image-domains', {
      method: 'PUT',
      headers: { ...(await adminHeaders(app)), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        provider: 'manual',
        manual: { records: [{ type: 'A', value: '999.0.0.1' }] },
      }),
    })
    expect(response.status).toBe(400)
  })

  it('lets Community administrators inspect the provider but not change or test it', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    expect((await app.request('/api/site/settings/image-domains', { headers })).status).toBe(200)

    const saved = await app.request('/api/site/settings/image-domains', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(manualSettings),
    })
    expect(saved.status).toBe(402)
    await expect(saved.json()).resolves.toMatchObject({
      error: {
        details: [
          {
            reason: 'FEATURE_NOT_AVAILABLE',
            metadata: { feature: 'image_custom_domains' },
          },
        ],
      },
    })

    const tested = await app.request('/api/site/settings/image-domains/tests', {
      method: 'POST',
      headers,
    })
    expect(tested.status).toBe(402)
  })
})
