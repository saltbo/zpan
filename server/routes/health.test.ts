import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup.js'

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
