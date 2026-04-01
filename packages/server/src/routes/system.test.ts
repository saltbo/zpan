import { describe, expect, it } from 'vitest'
import { authedHeaders, authedHeadersWithSignIn, createTestApp } from '../test/setup.js'

describe('System API', () => {
  it('GET /api/system/options returns empty list initially', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/system/options')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [] })
  })

  it('GET /api/system/options/:key returns 404 for missing key', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/system/options/site.name')
    expect(res.status).toBe(404)
  })

  it('GET /api/system/options/:key returns public option without auth', async () => {
    const { app } = createTestApp()
    const adminH = await authedHeadersWithSignIn(app, 'admin@example.com')

    await app.request('/api/admin/system/options/site.name', {
      method: 'PUT',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ZPan', public: true }),
    })

    const res = await app.request('/api/system/options/site.name')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ key: 'site.name', value: 'ZPan' })
  })

  it('GET /api/system/options/:key returns 401 for private option without auth', async () => {
    const { app } = createTestApp()
    const adminH = await authedHeadersWithSignIn(app, 'admin@example.com')

    await app.request('/api/admin/system/options/secret.key', {
      method: 'PUT',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'hidden', public: false }),
    })

    const res = await app.request('/api/system/options/secret.key')
    expect(res.status).toBe(401)
  })

  it('GET /api/system/options/:key returns private option with auth', async () => {
    const { app } = createTestApp()
    const adminH = await authedHeadersWithSignIn(app, 'admin@example.com')

    await app.request('/api/admin/system/options/secret.key', {
      method: 'PUT',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'hidden' }),
    })

    const res = await app.request('/api/system/options/secret.key', { headers: adminH })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ key: 'secret.key', value: 'hidden' })
  })

  it('GET /api/system/options lists only public options', async () => {
    const { app } = createTestApp()
    const adminH = await authedHeadersWithSignIn(app, 'admin@example.com')

    await app.request('/api/admin/system/options/site.name', {
      method: 'PUT',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ZPan', public: true }),
    })
    await app.request('/api/admin/system/options/secret.key', {
      method: 'PUT',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'hidden', public: false }),
    })

    const res = await app.request('/api/system/options')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { key: string; value: string }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toEqual({ key: 'site.name', value: 'ZPan' })
  })

  it('PUT /api/admin/system/options/:key returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/admin/system/options/site.name', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ZPan' }),
    })
    expect(res.status).toBe(401)
  })

  it('PUT /api/admin/system/options/:key returns 403 for non-admin', async () => {
    const { app } = createTestApp()
    // First user becomes admin; second user is regular
    await authedHeaders(app, 'admin@example.com')
    const userH = await authedHeaders(app, 'user@example.com')

    const res = await app.request('/api/admin/system/options/site.name', {
      method: 'PUT',
      headers: { ...userH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ZPan' }),
    })
    expect(res.status).toBe(403)
  })

  it('PUT /api/admin/system/options/:key upserts option', async () => {
    const { app } = createTestApp()
    const adminH = await authedHeadersWithSignIn(app, 'admin@example.com')

    const res = await app.request('/api/admin/system/options/site.name', {
      method: 'PUT',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ZPan', public: true }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ key: 'site.name', value: 'ZPan' })

    // Update the same key
    const res2 = await app.request('/api/admin/system/options/site.name', {
      method: 'PUT',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ZPan v2', public: true }),
    })
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2).toEqual({ key: 'site.name', value: 'ZPan v2' })
  })
})
