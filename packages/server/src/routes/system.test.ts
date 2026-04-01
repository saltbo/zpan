import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

describe('System API', () => {
  it('GET /api/system/options/:key works without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/system/options/site_name')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ key: 'site_name', value: '' })
  })

  it('PUT /api/system/options/:key returns 501 with auth', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/system/options/site_name', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'ZPan' }),
    })
    expect(res.status).toBe(501)
  })
})
