import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

describe('Storages API', () => {
  it('returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/storages')
    expect(res.status).toBe(401)
  })

  it('GET /api/storages returns empty list', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/storages', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('POST /api/storages returns 501', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'test' }),
    })
    expect(res.status).toBe(501)
  })

  it('GET /api/storages/:id returns 501', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/storages/abc', { headers })
    expect(res.status).toBe(501)
  })

  it('PUT /api/storages/:id returns 501', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/storages/abc', { method: 'PUT', headers })
    expect(res.status).toBe(501)
  })

  it('DELETE /api/storages/:id returns 501', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/storages/abc', { method: 'DELETE', headers })
    expect(res.status).toBe(501)
  })
})
