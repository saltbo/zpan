import { describe, expect, it } from 'vitest'
import { adminHeaders, createTestApp } from '../../test/setup'

const manualSettings = {
  enabled: true,
  provider: 'manual',
  manual: {
    records: [
      { type: 'A', value: '192.0.2.10' },
      { type: 'AAAA', value: '2001:db8::10' },
    ],
  },
} as const

describe('Admin image-domain provider API', () => {
  it('requires an administrator for every provider operation', async () => {
    const { app } = await createTestApp()
    expect((await app.request('/api/site/settings/image-domains')).status).toBe(401)
    expect(
      (
        await app.request('/api/site/settings/image-domains', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(manualSettings),
        })
      ).status,
    ).toBe(401)
    expect((await app.request('/api/site/settings/image-domains/tests', { method: 'POST' })).status).toBe(401)
  })

  it('saves, tests, and reads a self-managed provider', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const empty = await app.request('/api/site/settings/image-domains', { headers })
    expect(empty.status).toBe(200)
    await expect(empty.json()).resolves.toMatchObject({
      settings: { enabled: false, provider: null },
      status: 'disabled',
      domains: [],
    })

    const saved = await app.request('/api/site/settings/image-domains', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(manualSettings),
    })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toEqual({ success: true })

    const tested = await app.request('/api/site/settings/image-domains/tests', {
      method: 'POST',
      headers,
    })
    expect(tested.status).toBe(200)
    await expect(tested.json()).resolves.toEqual({ success: true })

    const current = await app.request('/api/site/settings/image-domains', { headers })
    expect(current.status).toBe(200)
    await expect(current.json()).resolves.toMatchObject({
      settings: manualSettings,
      status: 'ready',
      error: null,
    })
  })

  it('returns a validation error for an invalid manual DNS record', async () => {
    const { app } = await createTestApp()
    const response = await app.request('/api/site/settings/image-domains', {
      method: 'PUT',
      headers: { ...(await adminHeaders(app)), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        provider: 'manual',
        manual: { records: [{ type: 'A', value: '999.0.0.1' }] },
      }),
    })
    expect(response.status).toBe(400)
  })
})
