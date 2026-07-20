import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetChangelogCache } from '../../adapters/providers/changelog.js'
import { adminHeaders, createTestApp } from '../../test/setup.js'

describe('System API', () => {
  it('exposes instance info to admins only [spec: system/instance-info-admin-only]', async () => {
    const { app } = await createTestApp()
    expect((await app.request('/api/site/instance')).status).toBe(401)

    const res = await app.request('/api/site/instance', { headers: await adminHeaders(app) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; version: string; runtime?: string; platform?: string }
    expect(body.id).toBeTruthy()
    expect(body.version).toBeTruthy()
    expect(body.runtime).toBe('node')
    expect(body.platform).toBe('node')
  })

  describe('changelog', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      resetChangelogCache()
    })

    it('serves release information to admins only [spec: system/changelog-admin-only]', async () => {
      const { app } = await createTestApp()
      const markdown = '## [2.8.0] - 2026-07-01\n- product-facing notes'
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          new URL(String(url)).hostname === 'api.github.com'
            ? ({ ok: true, status: 200, json: async () => ({ tag_name: 'v2.8.0' }) } as unknown as Response)
            : ({ ok: true, status: 200, text: async () => markdown } as unknown as Response),
        ),
      )

      expect((await app.request('/api/site/changelog')).status).toBe(401)
      const res = await app.request('/api/site/changelog', { headers: await adminHeaders(app) })
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({ latestVersion: '2.8.0', markdown })
    })
  })
})
