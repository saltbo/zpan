import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
} from '../../../shared/captcha.js'
import { resetChangelogCache } from '../../adapters/providers/changelog.js'
import { adminHeaders, createTestApp } from '../../test/setup.js'

async function putOption(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  headers: Record<string, string>,
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/site/options/${key}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('System API — options CRUD', () => {
  it('exposes the effective WebDAV URL as a read-only runtime option [spec: system/webdav-url]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)
    const setPublicUrl = await putOption(app, admin, 'site_public_origin', {
      value: 'https://example.com',
      public: false,
    })
    expect(setPublicUrl.status).toBe(200)

    const list = await app.request('https://pan.example.com/api/site/options')
    const listBody = (await list.json()) as {
      items: Array<{ key: string; value: string; public: boolean }>
      total: number
    }
    expect(listBody.items).toContainEqual({ key: 'webdav_url', value: 'https://dav.example.com/', public: true })
    expect(listBody.total).toBe(listBody.items.length)

    const get = await app.request('https://pan.example.com/api/site/options/webdav_url')
    expect(get.status).toBe(200)
    expect(await get.json()).toEqual({ key: 'webdav_url', value: 'https://dav.example.com/', public: true })

    const put = await putOption(app, admin, 'webdav_url', { value: 'https://other.example.com' })
    expect(put.status).toBe(400)
    expect(await put.text()).toContain('read-only')

    const del = await app.request('/api/site/options/webdav_url', { method: 'DELETE', headers: admin })
    expect(del.status).toBe(400)
    expect(await del.text()).toContain('read-only')
  })

  it('derives the DAV hostname from an auto-detected Public URL', async () => {
    const { app } = await createTestApp()
    const res = await app.request('https://pan.example.com/api/site/options/webdav_url')

    expect(await res.json()).toEqual({ key: 'webdav_url', value: 'https://dav.pan.example.com/', public: true })
  })

  it('GET unknown key returns 404 [spec: system/option-not-found]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/options/site_name')
    expect(res.status).toBe(404)
  })

  it('full admin CRUD lifecycle with public/private visibility [spec: system/admin-crud]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    // Create public option
    const put = await putOption(app, admin, 'site_name', { value: 'ZPan', public: true })
    expect(put.status).toBe(201)
    expect(await put.json()).toEqual({ key: 'site_name', value: 'ZPan', public: true })

    // Anonymous can read public option
    const anonGet = await app.request('/api/site/options/site_name')
    expect(anonGet.status).toBe(200)
    expect(await anonGet.json()).toEqual({ key: 'site_name', value: 'ZPan', public: true })

    // Update preserves public flag when omitted
    const put2 = await putOption(app, admin, 'site_name', { value: 'v2' })
    expect(put2.status).toBe(200)
    expect(await put2.json()).toEqual({ key: 'site_name', value: 'v2', public: true })

    // Private option hidden from anonymous
    await putOption(app, admin, 'smtp_password', { value: 'secret', public: false })
    const anonPrivate = await app.request('/api/site/options/smtp_password')
    expect(anonPrivate.status).toBe(403)

    // Admin can read private option
    const adminPrivate = await app.request('/api/site/options/smtp_password', { headers: admin })
    expect(adminPrivate.status).toBe(200)
    expect(await adminPrivate.json()).toEqual({ key: 'smtp_password', value: 'secret', public: false })

    // List: anon sees only public, admin sees all
    const anonList = await app.request('/api/site/options')
    const anonBody = (await anonList.json()) as { items: { key: string }[]; total: number }
    expect(anonBody.total).toBe(2)
    expect(anonBody.items[0].key).toBe('site_name')
    expect(anonBody.items[1].key).toBe('webdav_url')

    const adminList = await app.request('/api/site/options', { headers: admin })
    const adminBody = (await adminList.json()) as { items: { key: string }[]; total: number }
    expect(adminBody.total).toBeGreaterThanOrEqual(2)
    expect(adminBody.items.map((item) => item.key)).toEqual(expect.arrayContaining(['site_name', 'smtp_password']))

    // Non-string value rejected
    const bad = await putOption(app, admin, 'site_name', { value: 123 })
    expect(bad.status).toBe(400)

    // Delete
    const del = await app.request('/api/site/options/site_name', { method: 'DELETE', headers: admin })
    expect(del.status).toBe(204)
    const afterDel = await app.request('/api/site/options/site_name')
    expect(afterDel.status).toBe(404)
  })

  it('unauthenticated mutations are rejected [spec: system/mutations-require-admin]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/options/site_name', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ZPan' }),
    })
    expect(res.status).toBe(401)

    const del = await app.request('/api/site/options/site_name', { method: 'DELETE' })
    expect(del.status).toBe(401)
  })

  it('rejects invalid default organization quota values [spec: system/validate-org-quota]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    for (const value of ['0', '-1', '1.5', 'abc']) {
      const res = await putOption(app, admin, 'default_org_quota', { value })
      expect(res.status).toBe(400)
    }
  })

  it('validates default monthly traffic quota values [spec: system/validate-traffic-quota]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    for (const value of ['', '   ', '-1', '1.5', 'abc']) {
      const res = await putOption(app, admin, 'default_org_monthly_traffic_quota', { value })
      expect(res.status).toBe(400)
    }

    const created = await putOption(app, admin, 'default_org_monthly_traffic_quota', { value: ' 1024 ' })
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({ value: '1024' })

    const updated = await putOption(app, admin, 'default_org_monthly_traffic_quota', { value: '0' })
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({ value: '0' })
  })

  it('exposes instance info to admins only [spec: system/instance-info-admin-only]', async () => {
    const { app } = await createTestApp()

    const anon = await app.request('/api/site/instance')
    expect(anon.status).toBe(401)

    const admin = await adminHeaders(app)
    const res = await app.request('/api/site/instance', { headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; version: string; runtime?: string; platform?: string }
    expect(body.id).toBeTruthy()
    expect(body.version).toBeTruthy()
    expect(body.runtime).toBe('node')
    expect(body.platform).toBe('node')
  })

  describe('changelog', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      resetChangelogCache()
    })

    it('serves the release version and changelog markdown to admins only [spec: system/changelog-admin-only]', async () => {
      const { app } = await createTestApp()
      resetChangelogCache()
      const markdown = '## [2.8.0] - 2026-07-01\n- product-facing notes'
      // The route fetches the latest release (api.github.com) and the raw
      // CHANGELOG.md separately; route each to its own stub.
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          new URL(String(url)).hostname === 'api.github.com'
            ? ({ ok: true, status: 200, json: async () => ({ tag_name: 'v2.8.0' }) } as unknown as Response)
            : ({ ok: true, status: 200, text: async () => markdown } as unknown as Response),
        ),
      )

      const anon = await app.request('/api/site/changelog')
      expect(anon.status).toBe(401)

      const admin = await adminHeaders(app)
      const res = await app.request('/api/site/changelog', { headers: admin })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        currentVersion: string
        latestVersion: string
        updateAvailable: boolean
        markdown: string
      }
      expect(body.latestVersion).toBe('2.8.0')
      expect(body.currentVersion).toBe('test-version')
      expect(body.markdown).toBe(markdown)
    })
  })

  it('keeps captcha secret private and rejects enabling captcha before keys exist [spec: system/captcha-secret-private]', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const missingKeys = await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true', public: true })
    expect(missingKeys.status).toBe(400)

    await putOption(app, admin, CAPTCHA_SITE_KEY_KEY, { value: 'site-key', public: false })
    await putOption(app, admin, CAPTCHA_PROVIDER_KEY, { value: 'cloudflare-turnstile', public: false })
    await putOption(app, admin, CAPTCHA_SECRET_OPTION_KEY, { value: 'secret-key', public: true })
    const enabled = await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true', public: false })
    expect(enabled.status).toBe(201)
    expect(await enabled.json()).toEqual({ key: CAPTCHA_ENABLED_KEY, value: 'true', public: true })

    const anonList = await app.request('/api/site/options')
    const anonBody = (await anonList.json()) as { items: { key: string }[] }
    expect(anonBody.items.map((item) => item.key)).toContain(CAPTCHA_SITE_KEY_KEY)
    expect(anonBody.items.map((item) => item.key)).toContain(CAPTCHA_PROVIDER_KEY)
    expect(anonBody.items.map((item) => item.key)).not.toContain(CAPTCHA_SECRET_OPTION_KEY)

    const adminSecret = await app.request(`/api/site/options/${CAPTCHA_SECRET_OPTION_KEY}`, { headers: admin })
    expect(adminSecret.status).toBe(200)
    expect(await adminSecret.json()).toEqual({ key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false })
  })
})
