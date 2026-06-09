import { describe, expect, it } from 'vitest'
import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
} from '../../shared/captcha.js'
import { adminHeaders, createTestApp } from '../test/setup.js'

async function putOption(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  headers: Record<string, string>,
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/system/options/${key}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('System API — options CRUD', () => {
  it('GET unknown key returns 404', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/system/options/site_name')
    expect(res.status).toBe(404)
  })

  it('full admin CRUD lifecycle with public/private visibility', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    // Create public option
    const put = await putOption(app, admin, 'site_name', { value: 'ZPan', public: true })
    expect(put.status).toBe(201)
    expect(await put.json()).toEqual({ key: 'site_name', value: 'ZPan', public: true })

    // Anonymous can read public option
    const anonGet = await app.request('/api/system/options/site_name')
    expect(anonGet.status).toBe(200)
    expect(await anonGet.json()).toEqual({ key: 'site_name', value: 'ZPan', public: true })

    // Update preserves public flag when omitted
    const put2 = await putOption(app, admin, 'site_name', { value: 'v2' })
    expect(put2.status).toBe(200)
    expect(await put2.json()).toEqual({ key: 'site_name', value: 'v2', public: true })

    // Private option hidden from anonymous
    await putOption(app, admin, 'smtp_password', { value: 'secret', public: false })
    const anonPrivate = await app.request('/api/system/options/smtp_password')
    expect(anonPrivate.status).toBe(403)

    // Admin can read private option
    const adminPrivate = await app.request('/api/system/options/smtp_password', { headers: admin })
    expect(adminPrivate.status).toBe(200)
    expect(await adminPrivate.json()).toEqual({ key: 'smtp_password', value: 'secret', public: false })

    // List: anon sees only public, admin sees all
    const anonList = await app.request('/api/system/options')
    const anonBody = (await anonList.json()) as { items: { key: string }[]; total: number }
    expect(anonBody.total).toBe(1)
    expect(anonBody.items[0].key).toBe('site_name')

    const adminList = await app.request('/api/system/options', { headers: admin })
    const adminBody = (await adminList.json()) as { items: { key: string }[]; total: number }
    expect(adminBody.total).toBeGreaterThanOrEqual(2)
    expect(adminBody.items.map((item) => item.key)).toEqual(expect.arrayContaining(['site_name', 'smtp_password']))

    // Non-string value rejected
    const bad = await putOption(app, admin, 'site_name', { value: 123 })
    expect(bad.status).toBe(400)

    // Delete
    const del = await app.request('/api/system/options/site_name', { method: 'DELETE', headers: admin })
    expect(del.status).toBe(200)
    const afterDel = await app.request('/api/system/options/site_name')
    expect(afterDel.status).toBe(404)
  })

  it('unauthenticated mutations are rejected', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/system/options/site_name', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ZPan' }),
    })
    expect(res.status).toBe(401)

    const del = await app.request('/api/system/options/site_name', { method: 'DELETE' })
    expect(del.status).toBe(401)
  })

  it('rejects invalid default organization quota values', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    for (const value of ['0', '-1', '1.5', 'abc']) {
      const res = await putOption(app, admin, 'default_org_quota', { value })
      expect(res.status).toBe(400)
    }
  })

  it('validates default monthly traffic quota values', async () => {
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

  it('exposes instance info to admins only', async () => {
    const { app } = await createTestApp()

    const anon = await app.request('/api/system/instance')
    expect(anon.status).toBe(401)

    const admin = await adminHeaders(app)
    const res = await app.request('/api/system/instance', { headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; version: string; runtime?: { provider: string } }
    expect(body.id).toBeTruthy()
    expect(body.version).toBeTruthy()
    expect(body.runtime?.provider).toBe('node')
  })

  it('keeps captcha secret private and rejects enabling captcha before keys exist', async () => {
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

    const anonList = await app.request('/api/system/options')
    const anonBody = (await anonList.json()) as { items: { key: string }[] }
    expect(anonBody.items.map((item) => item.key)).toContain(CAPTCHA_SITE_KEY_KEY)
    expect(anonBody.items.map((item) => item.key)).toContain(CAPTCHA_PROVIDER_KEY)
    expect(anonBody.items.map((item) => item.key)).not.toContain(CAPTCHA_SECRET_OPTION_KEY)

    const adminSecret = await app.request(`/api/system/options/${CAPTCHA_SECRET_OPTION_KEY}`, { headers: admin })
    expect(adminSecret.status).toBe(200)
    expect(await adminSecret.json()).toEqual({ key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false })
  })
})
