import { describe, expect, it } from 'vitest'
import * as schema from '../db/schema.js'
import { createTestApp } from '../test/setup.js'

describe('GET /api/licensing/status', () => {
  it('returns { bound: false } when no binding row exists', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/licensing/status')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ bound: false })
  })

  it('returns bound state with plan and features when binding row exists with cert', async () => {
    const { app, db } = await createTestApp()

    const entitlement = {
      account_id: 'acc-1',
      instance_id: 'inst-1',
      plan: 'pro',
      features: ['white_label', 'teams_unlimited'],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      cloudAccountId: 'acc-1',
      cloudAccountEmail: 'user@example.com',
      refreshToken: 'secret-refresh-token',
      cachedCert: JSON.stringify(entitlement),
      cachedExpiresAt: Math.floor(Date.now() / 1000) + 86400,
      lastRefreshAt: Math.floor(Date.now() / 1000),
      lastRefreshError: null,
      boundAt: Math.floor(Date.now() / 1000),
    })

    const res = await app.request('/api/licensing/status')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.bound).toBe(true)
    expect(body.account_email).toBe('user@example.com')
    expect(body.plan).toBe('pro')
    expect(body.features).toEqual(['white_label', 'teams_unlimited'])
    // refresh_token must never appear in the response
    expect(body.refresh_token).toBeUndefined()
    expect(body.refreshToken).toBeUndefined()
  })

  it('returns bound:true with no plan/features when cachedCert is null', async () => {
    const { app, db } = await createTestApp()

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      cloudAccountId: null,
      cloudAccountEmail: null,
      refreshToken: 'secret',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    const res = await app.request('/api/licensing/status')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.bound).toBe(true)
    expect(body.plan).toBeUndefined()
    expect(body.features).toBeUndefined()
  })

  it('is accessible without authentication', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/licensing/status')
    expect(res.status).toBe(200)
  })
})
