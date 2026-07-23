import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup'

describe('storage usage API', () => {
  it('requires authentication', async () => {
    const { app } = await createTestApp()
    expect((await app.request('/api/storage')).status).toBe(401)
  })

  it('returns the initialized projection without exposing runtime scans', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app, 'storage-usage@example.com')

    const usageResponse = await app.request('/api/storage', { headers })
    expect(usageResponse.status).toBe(200)
    const usage = (await usageResponse.json()) as {
      breakdowns: Array<{ category: string; bytes: number }>
    }
    expect(usage.breakdowns).toHaveLength(8)
    expect(usage.breakdowns.find((row) => row.category === 'trash')?.bytes).toBe(0)

    expect((await app.request('/api/storage/scans', { method: 'POST', headers })).status).toBe(404)
  })
})
