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
        '/api/downloads/tasks',
        '/api/downloads/tasks/{id}',
        '/api/downloads/tasks/{id}/status',
        '/api/downloads/tasks/{id}/attempts',
        '/api/downloads/downloaders/me/heartbeats',
        '/api/downloads/downloaders',
        '/api/downloads/downloaders/{id}',
        '/api/objects',
        '/api/objects/{id}/status',
        '/api/objects/{id}/uploads/{uploadSessionId}/status',
      ]),
    )
  })
})
