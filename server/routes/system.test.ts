import { describe, expect, it } from 'vitest'
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
    const adminBody = (await adminList.json()) as { total: number }
    expect(adminBody.total).toBe(2)

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
})
