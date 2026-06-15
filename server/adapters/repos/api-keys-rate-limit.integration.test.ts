import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../../test/setup.js'
import { ApiKeyRateLimitError } from '../../usecases/ports'
import { createApiKeyGateway } from './api-keys'

const apiKeys = createApiKeyGateway()

type TestApp = Awaited<ReturnType<typeof createTestApp>>

async function getUserAndOrg(db: TestApp['db']) {
  const users = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
  const orgs = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  if (!users[0] || !orgs[0]) throw new Error('expected seeded user and personal org')
  return { userId: users[0].id, orgId: orgs[0].id }
}

async function createOrgApiKey(
  auth: TestApp['auth'],
  configId: string,
  orgId: string,
  userId: string,
  rateLimitMax?: number,
) {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
  const result = (await (auth.api as any).createApiKey({
    body: {
      configId,
      organizationId: orgId,
      userId,
      ...(rateLimitMax === undefined ? {} : { rateLimitMax, rateLimitTimeWindow: 60_000, rateLimitEnabled: true }),
    },
  })) as { key: string; id: string }
  return result
}

async function getApiKeyRow(db: TestApp['db'], id: string) {
  const rows = await db.all<{
    config_id: string
    rate_limit_enabled: number
    rate_limit_time_window: number | null
    rate_limit_max: number | null
    request_count: number
  }>(sql`
    SELECT config_id, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count
    FROM apikey
    WHERE id = ${id}
  `)
  if (!rows[0]) throw new Error('expected api key row')
  return rows[0]
}

describe('API key rate limits', () => {
  it('persists the configured defaults for each API key template', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)

    const ihost = await createOrgApiKey(auth, 'ihost', orgId, userId)
    const remoteDownload = await createOrgApiKey(auth, 'remote-download', orgId, userId)
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const webdav = (await (auth.api as any).createApiKey({
      body: { configId: 'webdav', userId },
    })) as { key: string; id: string }

    expect(await getApiKeyRow(db, ihost.id)).toMatchObject({
      config_id: 'ihost',
      rate_limit_enabled: 1,
      rate_limit_time_window: 60_000,
      rate_limit_max: 60,
      request_count: 0,
    })
    expect(await getApiKeyRow(db, webdav.id)).toMatchObject({
      config_id: 'webdav',
      rate_limit_enabled: 1,
      rate_limit_time_window: 60_000,
      rate_limit_max: 120,
      request_count: 0,
    })
    expect(await getApiKeyRow(db, remoteDownload.id)).toMatchObject({
      config_id: 'remote-download',
      rate_limit_enabled: 1,
      rate_limit_time_window: 60_000,
      rate_limit_max: 120,
      request_count: 0,
    })
  })

  it('allows exactly maxRequests verifications before rejecting the next one', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)
    const apiKey = await createOrgApiKey(auth, 'remote-download', orgId, userId, 2)

    expect(await apiKeys.verifyApiKey(auth, db, apiKey.key, 'remote-download')).toMatchObject({ id: apiKey.id })
    expect(await apiKeys.verifyApiKey(auth, db, apiKey.key, 'remote-download')).toMatchObject({ id: apiKey.id })
    await expect(apiKeys.verifyApiKey(auth, db, apiKey.key, 'remote-download')).rejects.toThrow(ApiKeyRateLimitError)
    expect(await getApiKeyRow(db, apiKey.id)).toMatchObject({ request_count: 2 })
  })

  it('business routes surface a rate-limited API key as too many requests', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)
    const apiKey = await createOrgApiKey(auth, 'remote-download', orgId, userId, 1)
    const headers = { Authorization: `Bearer ${apiKey.key}` }

    const allowed = await app.request('/api/downloads/tasks', { headers })
    const limited = await app.request('/api/downloads/tasks', { headers })

    expect(allowed.status).toBe(200)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(await limited.json()).toEqual({ error: 'Rate limit exceeded.' })
  })

  it('WebDAV surfaces a rate-limited API key as too many requests', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { userId } = await getUserAndOrg(db)
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const apiKey = (await (auth.api as any).createApiKey({
      body: {
        configId: 'webdav',
        userId,
        permissions: { webdav: ['read'] },
        rateLimitMax: 1,
        rateLimitTimeWindow: 60_000,
        rateLimitEnabled: true,
      },
    })) as { key: string; id: string }
    const headers = { Authorization: `Basic ${btoa(`test:${apiKey.key}`)}` }

    const allowed = await app.request('/dav/', { method: 'PROPFIND', headers })
    const limited = await app.request('/dav/', { method: 'PROPFIND', headers })

    expect(allowed.status).not.toBe(429)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(await limited.text()).toBe('Rate limit exceeded.')
  })
})
