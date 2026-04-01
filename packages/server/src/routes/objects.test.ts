import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

describe('Objects API', () => {
  it('returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/objects')
    expect(res.status).toBe(401)
  })

  it('GET /api/objects returns empty list', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('GET /api/objects respects pagination params', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects?page=2&pageSize=10', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { page: number; pageSize: number }
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(10)
  })

  it('POST /api/objects returns 501 (not implemented)', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test.txt', type: 'text/plain', storageId: 's1' }),
    })
    expect(res.status).toBe(501)
  })

  it('GET /api/objects/:id returns 501', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/abc', { headers })
    expect(res.status).toBe(501)
  })

  it('PATCH /api/objects/:id returns 501', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/abc', { method: 'PATCH', headers })
    expect(res.status).toBe(501)
  })

  it('DELETE /api/objects/:id returns 501', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/abc', { method: 'DELETE', headers })
    expect(res.status).toBe(501)
  })
})
