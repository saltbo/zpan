import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

describe('Users API', () => {
  it('returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/users')
    expect(res.status).toBe(401)
  })

  it('GET /api/users returns empty list', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/users', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('PUT /api/users/:id/status returns 501', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/users/abc/status', { method: 'PUT', headers })
    expect(res.status).toBe(501)
  })
})
