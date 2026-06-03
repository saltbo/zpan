import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup'

describe('downloader OpenAPI', () => {
  it('serves downloader documentation from the real app route', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi/downloader.json')

    expect(res.status).toBe(200)
    const doc = (await res.json()) as { paths: Record<string, unknown> }
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/auth/device/code',
        '/api/auth/device/token',
        '/api/download-tasks',
        '/api/download-tasks/{id}',
        '/api/downloader/heartbeat',
        '/api/admin/downloaders',
        '/api/admin/downloaders/{id}',
        '/api/objects',
        '/api/objects/{id}',
      ]),
    )
  })
})
