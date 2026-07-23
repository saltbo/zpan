import { SignupMode } from '@shared/constants'
import { describe, expect, it, vi } from 'vitest'
import { adminHeaders, createTestApp } from '../../test/setup.js'

async function put(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  path: string,
  headers: Record<string, string>,
  body: unknown,
) {
  return app.request(`/api/site/settings/${path}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Site configuration API', () => {
  it('serves one structured public config document [spec: system/public-config]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('https://pan.example.com/api/configz')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      site: { name: 'ZPan', description: '', publicUrl: 'https://pan.example.com' },
      auth: { captcha: { enabled: false }, providers: [] },
      services: { webdav: { enabled: true, url: 'https://pan.example.com/dav/' } },
    })
    expect(body).toHaveProperty('branding')
  })

  it('requires admin for structured settings and removes generic Options [spec: system/settings-admin-only]', async () => {
    const { app } = await createTestApp()
    expect((await app.request('/api/site/settings')).status).toBe(401)
    expect((await app.request('/api/site/options')).status).toBe(404)
    expect((await app.request('/api/site/options/site_name')).status).toBe(404)

    const res = await app.request('/api/site/settings', { headers: await adminHeaders(app) })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      identity: { name: 'ZPan', description: '' },
      registration: { configuredMode: SignupMode.OPEN, effectiveMode: SignupMode.OPEN },
      captcha: { enabled: false, secretConfigured: false },
      webdav: {
        enabled: true,
        domain: '',
        pathUrl: expect.stringContaining('/dav/'),
        candidateUrl: expect.stringContaining('dav.'),
        status: 'unverified',
      },
    })
  })

  it('publishes the derived WebDAV domain only after verification [spec: system/webdav-url]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const update = await put(app, 'identity', admin, {
      name: 'ZPan',
      description: '',
      publicUrl: 'https://files.example.com/',
    })
    expect(update.status).toBe(200)
    await expect(update.json()).resolves.toEqual({
      name: 'ZPan',
      description: '',
      publicUrl: 'https://files.example.com',
    })

    const config = (await (await app.request('https://request.example.com/api/configz')).json()) as {
      site: { publicUrl: string }
      services: { webdav: { url: string } }
    }
    expect(config.site.publicUrl).toBe('https://files.example.com')
    expect(config.services.webdav.url).toBe('https://files.example.com/dav/')

    const probe = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="ZPan WebDAV"' },
      }),
    )
    const verification = await app.request('/api/site/settings/webdav/verification', {
      method: 'POST',
      headers: admin,
    })
    probe.mockRestore()
    expect(verification.status).toBe(200)
    await expect(verification.json()).resolves.toMatchObject({ status: 'ready' })

    const verifiedConfig = (await (await app.request('https://request.example.com/api/configz')).json()) as {
      services: { webdav: { url: string } }
    }
    expect(verifiedConfig.services.webdav.url).toBe('https://dav.files.example.com/')
  })

  it('uses the configured WebDAV domain and blocks requests when disabled', async () => {
    const { app } = await createTestApp()
    await app.request('https://pan.example.com/api/configz')
    const admin = await adminHeaders(app)
    const update = await put(app, 'webdav', admin, { enabled: false, domain: 'webdisk.example.net' })
    expect(update.status).toBe(200)

    const settings = await app.request('https://pan.example.com/api/site/settings', {
      headers: admin,
    })

    expect(settings.status).toBe(200)
    await expect(settings.json()).resolves.toMatchObject({
      webdav: {
        enabled: false,
        domain: 'webdisk.example.net',
        pathUrl: 'https://pan.example.com/dav/',
        candidateUrl: 'https://webdisk.example.net/',
        status: 'disabled',
      },
    })
    expect((await app.request('https://pan.example.com/dav/')).status).toBe(404)
  })

  it('requires admin for WebDAV verification', async () => {
    const { app } = await createTestApp()
    const response = await app.request('/api/site/settings/webdav/verification', { method: 'POST' })
    expect(response.status).toBe(401)
  })

  it('updates captcha as a group without returning its secret [spec: system/captcha-secret-private]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)
    const update = await put(app, 'captcha', admin, {
      enabled: true,
      provider: 'hcaptcha',
      siteKey: 'site-key',
      secretKey: 'secret-key',
      minScore: 0.7,
    })

    expect(update.status).toBe(200)
    const adminView = await update.json()
    expect(adminView).toEqual({
      enabled: true,
      provider: 'hcaptcha',
      siteKey: 'site-key',
      secretConfigured: true,
      minScore: 0.7,
    })

    const publicView = await (await app.request('/api/configz')).json()
    expect(publicView).toMatchObject({
      auth: { captcha: { enabled: true, provider: 'hcaptcha', siteKey: 'site-key' } },
    })
    expect(JSON.stringify(adminView)).not.toContain('secret-key')
    expect(JSON.stringify(publicView)).not.toContain('secret-key')
  })

  it('validates grouped quota and captcha requests [spec: system/settings-validation]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    expect(
      (
        await put(app, 'quotas', admin, {
          defaultOrgBytes: 0,
          defaultTeamBytes: 1024,
          defaultMonthlyTrafficBytes: 0,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await put(app, 'captcha', admin, {
          enabled: true,
          provider: 'hcaptcha',
          siteKey: '',
          secretKey: null,
          minScore: null,
        })
      ).status,
    ).toBe(400)
  })

  it('updates registration through its dedicated endpoint', async () => {
    const { app } = await createTestApp()
    const response = await put(app, 'registration', await adminHeaders(app), { mode: SignupMode.CLOSED })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      configuredMode: SignupMode.CLOSED,
      effectiveMode: SignupMode.CLOSED,
    })
  })

  it('publishes only minimal enabled OAuth provider metadata through configz', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)
    const created = await app.request('/api/site/auth-providers/github', {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'builtin',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        enabled: true,
      }),
    })
    expect(created.status).toBe(200)
    expect((await app.request('/api/site/auth-providers')).status).toBe(401)

    const config = await (await app.request('/api/configz')).json()
    expect(config).toMatchObject({
      auth: { providers: [{ id: 'github', type: 'builtin', name: 'GitHub', icon: 'github' }] },
    })
    expect(JSON.stringify(config)).not.toContain('client-id')
    expect(JSON.stringify(config)).not.toContain('client-secret')
  })
})
